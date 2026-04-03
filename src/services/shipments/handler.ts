import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  SQSEvent,
  SQSRecord,
} from "aws-lambda";
import { init } from "./context";
import {
  ShipmentDocument,
  ShipmentItem,
  OrderCreatedEventDetail,
  PaymentSucceededEventDetail,
} from "./types";
import { AppError, internalError } from "../../shared/errors";
import { createLogger } from "../../shared/logger";
import { generateShipmentId, generateRequestId } from "../../shared/ids";
import { jsonResponse, errorResponse, parseRoute } from "../../shared/http";

// ---------------------------------------------------------------------------
// Split shipping — mock warehouse assignment
// Items at even indices go to warehouse_A, odd to warehouse_B.
// Single-item orders produce one shipment.
// ---------------------------------------------------------------------------

function splitIntoGroups(items: ShipmentItem[]): ShipmentItem[][] {
  if (items.length <= 1) return [items];
  const groupA = items.filter((_, i) => i % 2 === 0);
  const groupB = items.filter((_, i) => i % 2 !== 0);
  return groupB.length > 0 ? [groupA, groupB] : [groupA];
}

// ---------------------------------------------------------------------------
// Event: order.created — store local projection (items + address)
// ---------------------------------------------------------------------------

async function handleOrderCreated(
  data: OrderCreatedEventDetail["data"],
  requestId: string,
): Promise<void> {
  const { orderId, items, customer } = data;
  const logger = createLogger(orderId, requestId);

  logger.info("Storing order projection from order.created", { orderId });

  const { orderProjectionRepository } = await init(logger);

  await orderProjectionRepository.upsert({
    _id: orderId,
    items,
    shippingAddress: customer.shippingAddress,
    createdAt: new Date().toISOString(),
  });

  logger.info("Order projection stored", { orderId });
}

// ---------------------------------------------------------------------------
// Event: payment.succeeded — create shipment(s) from projection
// ---------------------------------------------------------------------------

async function handlePaymentSucceeded(
  data: PaymentSucceededEventDetail["data"],
  requestId: string,
): Promise<void> {
  const { orderId } = data;
  const logger = createLogger(orderId, requestId);

  logger.info("Processing payment.succeeded — initiating shipment(s)", { orderId });

  const { shipmentRepository, orderProjectionRepository, shipmentEvents, shippingProvider } =
    await init(logger);

  const projection = await orderProjectionRepository.findByOrderId(orderId);
  const itemGroups = splitIntoGroups(projection.items);

  logger.info("Shipment groups determined", {
    orderId,
    groupCount: itemGroups.length,
  });

  for (const group of itemGroups) {
    const shipmentId = generateShipmentId();
    const now = new Date().toISOString();

    const shipment: ShipmentDocument = {
      _id: shipmentId,
      orderId,
      items: group,
      shippingAddress: projection.shippingAddress,
      provider: "dhl",
      trackingNumber: null,
      status: "created",
      retryCount: 0,
      circuitState: "closed",
      shippedAt: null,
      deliveredAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await shipmentRepository.insert(shipment);

    const { trackingNumber } = await shippingProvider.ship({
      shipmentId,
      orderId,
      items: group,
      address: projection.shippingAddress,
    });

    const shippedAt = new Date().toISOString();
    await shipmentRepository.updateTrackingNumber(shipmentId, trackingNumber, shippedAt);

    await shipmentEvents.publishShipmentCreated({
      ...shipment,
      trackingNumber,
      status: "in_transit",
      shippedAt,
      updatedAt: shippedAt,
    });

    logger.info("Shipment created", { shipmentId, trackingNumber, orderId });
  }
}

// ---------------------------------------------------------------------------
// Webhook: POST /v1/webhooks/shipment-status — DHL delivery callback
// ---------------------------------------------------------------------------

interface WebhookPayload {
  provider: string;
  trackingNumber: string;
  status: string;
  timestamp: string;
  signature?: string;
}

async function handleWebhook(
  event: APIGatewayProxyEventV2,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const logger = createLogger(undefined, requestId);

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(event.body ?? "{}");
  } catch {
    return errorResponse(
      new AppError("VALIDATION_ERROR", "Invalid webhook payload", 400),
      requestId,
    );
  }

  const { trackingNumber, status, timestamp } = payload;

  if (!trackingNumber || !status) {
    return errorResponse(
      new AppError("VALIDATION_ERROR", "trackingNumber and status are required", 400),
      requestId,
    );
  }

  if (status !== "delivered") {
    // Only act on delivered; other statuses are informational
    logger.info("Webhook received — no action for status", { trackingNumber, status });
    return jsonResponse(200, { received: true });
  }

  const webhookLogger = logger.child({ correlationId: trackingNumber });
  webhookLogger.info("Processing delivery webhook", { trackingNumber });

  const { shipmentRepository, shipmentEvents } = await init(webhookLogger);

  const shipment = await shipmentRepository.findByTrackingNumber(trackingNumber);
  const deliveredAt = timestamp ?? new Date().toISOString();

  await shipmentRepository.updateDelivered(shipment._id, deliveredAt);
  await shipmentEvents.publishShipmentDelivered({
    ...shipment,
    status: "delivered",
    deliveredAt,
    updatedAt: deliveredAt,
  });

  webhookLogger.info("Shipment marked delivered", {
    shipmentId: shipment._id,
    orderId: shipment.orderId,
  });

  return jsonResponse(200, { received: true });
}

// ---------------------------------------------------------------------------
// SQS handler — order.created + payment.succeeded
// ---------------------------------------------------------------------------

async function processRecord(record: SQSRecord, requestId: string): Promise<void> {
  const logger = createLogger(undefined, requestId);

  let envelope: { "detail-type": string; detail: unknown };
  try {
    envelope = JSON.parse(record.body);
  } catch {
    logger.error("Failed to parse SQS message body", { messageId: record.messageId });
    throw new Error(`Invalid SQS message body: ${record.messageId}`);
  }

  const detailType = envelope["detail-type"];

  if (detailType === "order.created") {
    const e = envelope as { "detail-type": string; detail: OrderCreatedEventDetail };
    await handleOrderCreated(e.detail.data, requestId);
    return;
  }

  if (detailType === "payment.succeeded") {
    const e = envelope as { "detail-type": string; detail: PaymentSucceededEventDetail };
    await handlePaymentSucceeded(e.detail.data, requestId);
    return;
  }

  logger.warn("Skipping unrecognised event type", {
    detailType,
    messageId: record.messageId,
  });
}

export const sqsHandler = async (event: SQSEvent): Promise<void> => {
  const requestId = generateRequestId();
  const logger = createLogger(undefined, requestId);

  logger.info("SQS batch received", { recordCount: event.Records.length, requestId });

  for (const record of event.Records) {
    await processRecord(record, requestId);
  }
};

// ---------------------------------------------------------------------------
// API handler — POST /v1/webhooks/shipment-status
// ---------------------------------------------------------------------------

export const apiHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const requestId = generateRequestId();
  const logger = createLogger(undefined, requestId);

  try {
    const { method, path } = parseRoute(event);
    logger.info("Received request", { method, path, requestId });

    if (method === "POST" && path === "/v1/webhooks/shipment-status") {
      return await handleWebhook(event, requestId);
    }

    return jsonResponse(404, {
      error: { code: "NOT_FOUND", message: `Route ${method} ${path} not found`, requestId },
    });
  } catch (err) {
    if (err instanceof AppError) {
      return errorResponse(err, requestId);
    }
    logger.error("Unhandled error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return errorResponse(internalError("An unexpected error occurred"), requestId);
  }
};
