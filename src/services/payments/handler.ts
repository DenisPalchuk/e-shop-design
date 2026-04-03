import { SQSEvent, SQSRecord } from "aws-lambda";
import { init } from "./context";
import {
  PaymentDocument,
  OrderCreatedEventDetail,
  InvoiceGeneratedEventDetail,
} from "./types";
import { createLogger } from "../../shared/logger";
import { generatePaymentId, generateRequestId } from "../../shared/ids";

type EventBridgeEnvelope<T> = { "detail-type": string; detail: T };

// ---------------------------------------------------------------------------
// Event: order.created — store a pending payment authorization for later capture
// ---------------------------------------------------------------------------

async function handleOrderCreated(
  data: OrderCreatedEventDetail["data"],
  requestId: string,
): Promise<void> {
  const { orderId, paymentAuthorization } = data;
  const logger = createLogger(orderId, requestId);

  logger.info("Storing pending payment record from order.created", { orderId });

  const { paymentRepository } = await init(logger);

  const now = new Date().toISOString();
  const payment: PaymentDocument = {
    _id: generatePaymentId(),
    orderId,
    provider: paymentAuthorization.provider,
    status: "pending",
    amountCents: 0, // unknown until invoice.generated
    authorizationRef: paymentAuthorization.authorizationRef,
    transactionRef: null,
    idempotencyKey: `${orderId}_pay`,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
  };

  await paymentRepository.insert(payment);
  logger.info("Pending payment record stored", { paymentId: payment._id, orderId });
}

// ---------------------------------------------------------------------------
// Event: invoice.generated — charge the customer
// ---------------------------------------------------------------------------

async function handleInvoiceGenerated(
  data: InvoiceGeneratedEventDetail["data"],
  requestId: string,
): Promise<void> {
  const { orderId, grandTotalCents } = data;
  const logger = createLogger(orderId, requestId);

  logger.info("Processing invoice.generated — initiating charge", {
    orderId,
    grandTotalCents,
  });

  const { paymentRepository, paymentEvents, paymentProvider } = await init(logger);

  const payment = await paymentRepository.findByOrderId(orderId);

  // Idempotency: skip if already processed
  if (payment.status !== "pending") {
    logger.info("Payment already processed, skipping", {
      paymentId: payment._id,
      status: payment.status,
    });
    return;
  }

  // Update amount now that we know it
  await paymentRepository.updateStatus(payment._id, "pending", {});

  try {
    const result = await paymentProvider.capture({
      amountCents: grandTotalCents,
      authorizationRef: payment.authorizationRef,
      idempotencyKey: payment.idempotencyKey,
    });

    await paymentRepository.updateStatus(payment._id, "succeeded", {
      transactionRef: result.transactionRef,
    });

    const updated = await paymentRepository.findByOrderId(orderId);
    await paymentEvents.publishPaymentSucceeded(updated);

    logger.info("Payment succeeded", {
      paymentId: payment._id,
      transactionRef: result.transactionRef,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";

    await paymentRepository.updateStatus(payment._id, "failed", {
      failureReason: reason,
    });

    const updated = await paymentRepository.findByOrderId(orderId);
    await paymentEvents.publishPaymentFailed(updated);

    logger.warn("Payment failed", { paymentId: payment._id, reason });
  }
}

// ---------------------------------------------------------------------------
// SQS handler — dispatches on detail-type
// ---------------------------------------------------------------------------

async function processRecord(record: SQSRecord, requestId: string): Promise<void> {
  const logger = createLogger(undefined, requestId);

  let envelope: EventBridgeEnvelope<unknown>;
  try {
    envelope = JSON.parse(record.body);
  } catch {
    logger.error("Failed to parse SQS message body", { messageId: record.messageId });
    throw new Error(`Invalid SQS message body: ${record.messageId}`);
  }

  const detailType = envelope["detail-type"];

  if (detailType === "order.created") {
    const event = envelope as EventBridgeEnvelope<OrderCreatedEventDetail>;
    await handleOrderCreated(event.detail.data, requestId);
    return;
  }

  if (detailType === "invoice.generated") {
    const event = envelope as EventBridgeEnvelope<InvoiceGeneratedEventDetail>;
    await handleInvoiceGenerated(event.detail.data, requestId);
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
