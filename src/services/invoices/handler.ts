import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, SQSEvent, SQSRecord } from "aws-lambda";
import { init } from "./context";
import { InvoiceDocument, OrderPricedEventDetail, GetInvoiceResponse } from "./types";
import { AppError, internalError } from "../../shared/errors";
import { createLogger } from "../../shared/logger";
import { generateInvoiceId, generateRequestId } from "../../shared/ids";
import { jsonResponse, errorResponse, getPathParam, parseRoute } from "../../shared/http";

// ---------------------------------------------------------------------------
// SQS handler — processes order.priced events from EventBridge via SQS
// ---------------------------------------------------------------------------

async function processOrderPriced(
  record: SQSRecord,
  requestId: string,
): Promise<void> {
  const logger = createLogger(undefined, requestId);

  // SQS message body is the raw EventBridge event JSON
  let event: { "detail-type": string; detail: OrderPricedEventDetail };
  try {
    event = JSON.parse(record.body);
  } catch {
    logger.error("Failed to parse SQS message body", { messageId: record.messageId });
    throw new Error(`Invalid SQS message body: ${record.messageId}`);
  }

  if (event["detail-type"] !== "order.priced") {
    logger.warn("Skipping unrecognised event type", {
      detailType: event["detail-type"],
      messageId: record.messageId,
    });
    return;
  }

  const { orderId, lineItems, shippingCostCents, grandTotalCents, customer } =
    event.detail.data;

  const orderLogger = logger.child({ correlationId: orderId });
  orderLogger.info("Processing order.priced event", { orderId });

  const { invoiceRepository, invoiceEvents } = await init(orderLogger);

  const invoiceNumber = await invoiceRepository.nextInvoiceNumber();
  const invoiceId = generateInvoiceId();
  const now = new Date().toISOString();

  const invoice: InvoiceDocument = {
    _id: invoiceId,
    invoiceNumber,
    orderId,
    customer: {
      name: customer.name,
      email: customer.email,
      billingAddress: customer.billingAddress,
    },
    lineItems,
    shippingCostCents,
    grandTotalCents,
    currency: "USD",
    issuedAt: now,
  };

  await invoiceRepository.insert(invoice);
  await invoiceEvents.publishInvoiceGenerated(invoice);

  orderLogger.info("Invoice generated successfully", { orderId, invoiceId, invoiceNumber });
}

export const sqsHandler = async (event: SQSEvent): Promise<void> => {
  const requestId = generateRequestId();
  const logger = createLogger(undefined, requestId);

  logger.info("SQS batch received", { recordCount: event.Records.length, requestId });

  // Process records sequentially — partial batch failure is handled by throwing
  for (const record of event.Records) {
    await processOrderPriced(record, requestId);
  }
};

// ---------------------------------------------------------------------------
// API handler — GET /v1/orders/{orderId}/invoice
// ---------------------------------------------------------------------------

async function handleGetInvoice(
  event: APIGatewayProxyEventV2,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const orderId = getPathParam(event, "orderId") ?? "";
  const logger = createLogger(orderId, requestId);

  logger.info("Processing GET /v1/orders/{orderId}/invoice", { orderId });

  if (!orderId) {
    return errorResponse(
      new AppError("NOT_FOUND", "orderId path parameter is missing", 404),
      requestId,
    );
  }

  const { invoiceRepository } = await init(logger);
  const invoice = await invoiceRepository.findByOrderId(orderId);

  const response: GetInvoiceResponse = {
    invoiceId: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
    orderId: invoice.orderId,
    customer: invoice.customer,
    lineItems: invoice.lineItems,
    shippingCostCents: invoice.shippingCostCents,
    grandTotalCents: invoice.grandTotalCents,
    currency: invoice.currency,
    issuedAt: invoice.issuedAt,
  };

  logger.info("Invoice fetched and returned", { orderId, invoiceId: invoice._id });
  return jsonResponse(200, response);
}

export const apiHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const requestId = generateRequestId();
  const logger = createLogger(undefined, requestId);

  try {
    const { method, path } = parseRoute(event);
    logger.info("Received request", { method, path, requestId });

    if (method === "GET" && /^\/v1\/orders\/[^/]+\/invoice$/.test(path)) {
      return await handleGetInvoice(event, requestId);
    }

    return jsonResponse(404, {
      error: { code: "NOT_FOUND", message: `Route ${method} ${path} not found`, requestId },
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
    return errorResponse(internalError("An unexpected error occurred"), requestId);
  }
};
