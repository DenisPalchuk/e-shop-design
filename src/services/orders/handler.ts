import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  SQSEvent,
  SQSRecord,
} from "aws-lambda";
import { ClientSession } from "mongodb";
import { validateCreateOrder } from "./validation";
import { init, OrdersContext } from "./context";
import {
  OrderDocument,
  CreateOrderResponse,
  GetOrderResponse,
  ShipmentCreatedEventDetail,
  ShipmentDeliveredEventDetail,
  ShipmentSummary,
} from "./types";
import { AppError, conflictError, internalError } from "../../shared/errors";
import { createLogger, Logger } from "../../shared/logger";
import { generateOrderId, generateRequestId } from "../../shared/ids";
import { runInTransaction } from "../../shared/db";
import {
  errorResponse,
  getPathParam,
  jsonResponse,
  parseRoute,
} from "../../shared/http";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type OrdersInitializer = (logger: Logger) => Promise<OrdersContext>;
type TransactionRunner = <T>(
  work: (session: ClientSession) => Promise<T>,
) => Promise<T>;

interface CreateOrderDependencies {
  initOrders?: OrdersInitializer;
  transactionRunner?: TransactionRunner;
  orderIdFactory?: () => string;
  nowFactory?: () => Date;
  loggerFactory?: typeof createLogger;
}

async function claimIdempotencyKey(
  idempotencyKey: string,
  requestId: string,
  idempotencyRepository: OrdersContext["idempotencyRepository"],
  logger: Logger,
): Promise<
  | { kind: "claimed" }
  | { kind: "completed"; response: CreateOrderResponse; orderId: string }
> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const claim = await idempotencyRepository.claimOrGet(idempotencyKey, requestId);

    if (claim.kind === "claimed" || claim.kind === "completed") {
      return claim;
    }

    if (claim.kind === "stale_pending") {
      const takenOver = await idempotencyRepository.takeOverIfStale(
        idempotencyKey,
        requestId,
      );
      if (takenOver) {
        logger.info("Took over stale idempotency claim", {
          idempotencyKey,
          requestId,
        });
        return { kind: "claimed" };
      }

      continue;
    }

    logger.info("Waiting for in-flight idempotent order creation", {
      idempotencyKey,
      requestId,
      attempt,
    });

    const waited = await idempotencyRepository.waitForCompletion(idempotencyKey);

    if (waited.kind === "completed") {
      return waited;
    }

    if (waited.kind === "missing") {
      continue;
    }

    if (waited.kind === "stale_pending") {
      const takenOver = await idempotencyRepository.takeOverIfStale(
        idempotencyKey,
        requestId,
      );
      if (takenOver) {
        logger.info("Took over stale idempotency claim after waiting", {
          idempotencyKey,
          requestId,
        });
        return { kind: "claimed" };
      }

      continue;
    }

    throw conflictError(
      "An order with this idempotency key is already being processed",
    );
  }

  throw conflictError(
    "Unable to acquire the idempotency key after repeated contention",
  );
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export async function handleCreateOrder(
  event: APIGatewayProxyEventV2,
  requestId: string,
  dependencies: CreateOrderDependencies = {},
): Promise<APIGatewayProxyResultV2> {
  const loggerFactory = dependencies.loggerFactory ?? createLogger;
  const logger = loggerFactory(undefined, requestId);
  const initOrders = dependencies.initOrders ?? init;
  const transactionRunner = dependencies.transactionRunner ?? runInTransaction;
  const orderIdFactory = dependencies.orderIdFactory ?? generateOrderId;
  const nowFactory = dependencies.nowFactory ?? (() => new Date());

  // Parse body
  let rawBody: unknown;
  try {
    rawBody = event.body ? JSON.parse(event.body) : {};
  } catch {
    const err = new AppError(
      "VALIDATION_ERROR",
      "Request body is not valid JSON",
      400,
    );
    return errorResponse(err, requestId);
  }

  // Resolve idempotency key — body first, then header
  const headerKey =
    event.headers?.["x-idempotency-key"] ??
    event.headers?.["X-Idempotency-Key"];

  // Validate input (throws AppError on failure)
  const input = validateCreateOrder(rawBody, headerKey);
  const { idempotencyKey } = input;

  const childLogger = logger.child({ correlationId: idempotencyKey });
  childLogger.info("Processing POST /v1/orders", {
    shippingMethod: input.shippingMethod,
    itemCount: input.items.length,
    customerEmail: input.customer.email,
  });

  const { ordersRepository, idempotencyRepository, ordersEvents, paymentProvider } =
    await initOrders(childLogger);

  const claim = await claimIdempotencyKey(
    idempotencyKey,
    requestId,
    idempotencyRepository,
    childLogger,
  );

  if (claim.kind === "completed") {
    childLogger.info("Returning cached idempotent response", {
      orderId: claim.orderId,
    });
    return jsonResponse(200, claim.response);
  }

  // --- Create order ---
  const orderId = orderIdFactory();
  const now = nowFactory();
  const authorization = await paymentProvider.authorize({
    token: input.payment.token,
    idempotencyKey: `${idempotencyKey}_authorize`,
  });

  const order: OrderDocument = {
    _id: orderId,
    status: "pending",
    customer: {
      name: input.customer.name,
      email: input.customer.email,
      shippingAddress: input.customer.shippingAddress,
      billingAddress: input.customer.billingAddress,
    },
    items: input.items,
    shippingMethod: input.shippingMethod,
    paymentProvider: input.payment.provider,
    paymentAuthorizationRef: authorization.authorizationRef,
    grandTotalCents: null,
    invoiceId: null,
    shipments: [],
    statusHistory: [{ status: "pending", timestamp: now.toISOString() }],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  // --- Build response ---
  const response: CreateOrderResponse = {
    orderId,
    status: "pending",
    items: order.items,
    shippingMethod: order.shippingMethod,
    customer: { email: order.customer.email },
    createdAt: order.createdAt,
  };

  try {
    await transactionRunner(async (session) => {
      await ordersRepository.insert(order, session);
      await idempotencyRepository.complete(
        idempotencyKey,
        requestId,
        orderId,
        response,
        session,
      );
    });
  } catch (error) {
    try {
      await idempotencyRepository.releasePending(idempotencyKey, requestId);
    } catch (releaseError) {
      childLogger.error("Failed to release pending idempotency record", {
        idempotencyKey,
        requestId,
        error:
          releaseError instanceof Error
            ? releaseError.message
            : String(releaseError),
      });
    }

    throw error;
  }

  await ordersEvents.publishOrderCreated(order);

  childLogger.info("Order created successfully", { orderId });
  return jsonResponse(201, response);
}

async function handleGetOrder(
  event: APIGatewayProxyEventV2,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const orderId = getPathParam(event, "orderId") ?? "";
  const logger = createLogger(orderId, requestId);

  logger.info("Processing GET /v1/orders/{orderId}", { orderId });

  if (!orderId) {
    const err = new AppError(
      "NOT_FOUND",
      "orderId path parameter is missing",
      404,
    );
    return errorResponse(err, requestId);
  }

  const { ordersRepository } = await init(logger);
  const order = await ordersRepository.findById(orderId);

  const response: GetOrderResponse = {
    orderId: order._id,
    status: order.status,
    customer: {
      name: order.customer.name,
      email: order.customer.email,
      shippingAddress: order.customer.shippingAddress,
    },
    items: order.items,
    shippingMethod: order.shippingMethod,
    shippingCostCents: null,
    grandTotalCents: order.grandTotalCents,
    invoiceId: order.invoiceId,
    payment: {
      status: order.status === "pending" ? "pending" : "processed",
      provider: order.paymentProvider,
    },
    shipments: order.shipments,
    statusHistory: order.statusHistory,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };

  logger.info("Order fetched and returned", { orderId });
  return jsonResponse(200, response);
}

// ---------------------------------------------------------------------------
// Lambda entry point
// ---------------------------------------------------------------------------

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const requestId = generateRequestId();
  const logger = createLogger(undefined, requestId);

  try {
    const { method, path } = parseRoute(event);

    logger.info("Received request", { method, path, requestId });

    // POST /v1/orders
    if (method === "POST" && path === "/v1/orders") {
      return await handleCreateOrder(event, requestId);
    }

    // GET /v1/orders/{orderId}
    if (method === "GET" && /^\/v1\/orders\/[^/]+$/.test(path)) {
      return await handleGetOrder(event, requestId);
    }

    logger.warn("Route not found", { method, path });
    return jsonResponse(404, {
      error: {
        code: "NOT_FOUND",
        message: `Route ${method} ${path} not found`,
        requestId,
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      logger.warn("Request failed with application error", {
        code: err.code,
        message: err.message,
        httpStatus: err.httpStatus,
      });
      return errorResponse(err, requestId);
    }

    logger.error("Unhandled error", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });

    return errorResponse(
      internalError("An unexpected error occurred"),
      requestId,
    );
  }
};

// ---------------------------------------------------------------------------
// SQS handler — consumes shipment.created / shipment.delivered
// ---------------------------------------------------------------------------

async function handleShipmentCreated(
  data: ShipmentCreatedEventDetail["data"],
  requestId: string,
): Promise<void> {
  const { orderId, shipmentId, trackingNumber, provider, items, shippedAt } = data;
  const logger = createLogger(orderId, requestId);

  logger.info("Recording shipment on order", { orderId, shipmentId });

  const { ordersRepository } = await init(logger);

  const summary: ShipmentSummary = {
    shipmentId,
    status: "in_transit",
    trackingNumber,
    provider,
    items,
    shippedAt,
    deliveredAt: null,
  };

  await ordersRepository.addShipment(orderId, summary);
  logger.info("Shipment recorded on order", { orderId, shipmentId, trackingNumber });
}

async function handleShipmentDelivered(
  data: ShipmentDeliveredEventDetail["data"],
  requestId: string,
): Promise<void> {
  const { orderId, shipmentId, deliveredAt } = data;
  const logger = createLogger(orderId, requestId);

  logger.info("Marking shipment delivered on order", { orderId, shipmentId });

  const { ordersRepository } = await init(logger);
  await ordersRepository.markShipmentDelivered(orderId, shipmentId, deliveredAt);

  logger.info("Shipment delivery recorded on order", { orderId, shipmentId });
}

async function processSqsRecord(record: SQSRecord, requestId: string): Promise<void> {
  const logger = createLogger(undefined, requestId);

  let envelope: { "detail-type": string; detail: unknown };
  try {
    envelope = JSON.parse(record.body);
  } catch {
    logger.error("Failed to parse SQS message body", { messageId: record.messageId });
    throw new Error(`Invalid SQS message body: ${record.messageId}`);
  }

  const detailType = envelope["detail-type"];

  if (detailType === "shipment.created") {
    const e = envelope as { "detail-type": string; detail: ShipmentCreatedEventDetail };
    await handleShipmentCreated(e.detail.data, requestId);
    return;
  }

  if (detailType === "shipment.delivered") {
    const e = envelope as { "detail-type": string; detail: ShipmentDeliveredEventDetail };
    await handleShipmentDelivered(e.detail.data, requestId);
    return;
  }

  logger.warn("Skipping unrecognised event type", { detailType, messageId: record.messageId });
}

export const sqsHandler = async (event: SQSEvent): Promise<void> => {
  const requestId = generateRequestId();
  const logger = createLogger(undefined, requestId);

  logger.info("SQS batch received", { recordCount: event.Records.length, requestId });

  for (const record of event.Records) {
    await processSqsRecord(record, requestId);
  }
};
