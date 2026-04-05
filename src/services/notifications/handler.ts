import { SQSEvent, SQSRecord } from "aws-lambda";
import { init } from "./context";
import {
  NotificationDocument,
  CustomerProjectionDocument,
  OrderCreatedEventDetail,
  PaymentSucceededEventDetail,
  PaymentFailedEventDetail,
  ShipmentCreatedEventDetail,
  ShipmentDeliveredEventDetail,
  InventoryFailedEventDetail,
} from "./types";
import { createLogger } from "../../shared/logger";
import { generateNotificationId, generateRequestId } from "../../shared/ids";

type EventBridgeEnvelope<T> = { "detail-type": string; detail: T };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sendNotification(
  ctx: Awaited<ReturnType<typeof init>>,
  orderId: string,
  idempotencyKey: string,
  recipient: string,
  subject: string,
  body: string,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  const alreadySent = await ctx.notificationRepository.existsByIdempotencyKey(idempotencyKey);
  if (alreadySent) {
    logger.info("Notification already sent, skipping", { idempotencyKey });
    return;
  }

  const notification: NotificationDocument = {
    _id: generateNotificationId(),
    orderId,
    idempotencyKey,
    channel: "email",
    recipient,
    subject,
    status: "sent",
    failureReason: null,
    createdAt: new Date().toISOString(),
  };

  try {
    await ctx.notificationProvider.sendEmail({ to: recipient, subject, body });
    await ctx.notificationRepository.insert(notification);
    logger.info("Notification sent", { idempotencyKey, recipient });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    logger.warn("Failed to send notification", { idempotencyKey, recipient, reason });
    await ctx.notificationRepository.insert({ ...notification, status: "failed", failureReason: reason });
    // Notification failures do not block the main order flow (FR-6.3) — do not re-throw
  }
}

async function requireCustomer(
  ctx: Awaited<ReturnType<typeof init>>,
  orderId: string,
  logger: ReturnType<typeof createLogger>,
): Promise<CustomerProjectionDocument | null> {
  const customer = await ctx.customerRepository.findByOrderId(orderId);
  if (!customer) {
    logger.warn("Customer projection not found for order — cannot send notification", { orderId });
  }
  return customer;
}

// ---------------------------------------------------------------------------
// Event: order.created — store customer projection + send order confirmed email
// ---------------------------------------------------------------------------

async function handleOrderCreated(
  data: OrderCreatedEventDetail["data"],
  requestId: string,
): Promise<void> {
  const { orderId, customer } = data;
  const logger = createLogger(orderId, requestId);

  logger.info("Handling order.created for notifications", { orderId });

  const ctx = await init(logger);

  const projection: CustomerProjectionDocument = {
    _id: orderId,
    name: customer.name,
    email: customer.email,
    createdAt: new Date().toISOString(),
  };

  await ctx.customerRepository.upsert(projection);

  await sendNotification(
    ctx,
    orderId,
    `${orderId}_order_confirmed`,
    customer.email,
    "Your order has been confirmed",
    `Hi ${customer.name},\n\nYour order (${orderId}) has been confirmed and is being processed.\n\nThank you for shopping with us!`,
    logger,
  );
}

// ---------------------------------------------------------------------------
// Event: payment.succeeded — send payment processed email
// ---------------------------------------------------------------------------

async function handlePaymentSucceeded(
  data: PaymentSucceededEventDetail["data"],
  requestId: string,
): Promise<void> {
  const { orderId, transactionRef } = data;
  const logger = createLogger(orderId, requestId);

  logger.info("Handling payment.succeeded for notifications", { orderId });

  const ctx = await init(logger);
  const customer = await requireCustomer(ctx, orderId, logger);
  if (!customer) return;

  await sendNotification(
    ctx,
    orderId,
    `${orderId}_payment_succeeded`,
    customer.email,
    "Payment confirmed for your order",
    `Hi ${customer.name},\n\nYour payment has been successfully processed for order ${orderId}.\nTransaction reference: ${transactionRef}\n\nYour order is now being prepared for shipment.`,
    logger,
  );
}

// ---------------------------------------------------------------------------
// Event: payment.failed — send payment failure email (order held)
// ---------------------------------------------------------------------------

async function handlePaymentFailed(
  data: PaymentFailedEventDetail["data"],
  requestId: string,
): Promise<void> {
  const { orderId, reason } = data;
  const logger = createLogger(orderId, requestId);

  logger.info("Handling payment.failed for notifications", { orderId });

  const ctx = await init(logger);
  const customer = await requireCustomer(ctx, orderId, logger);
  if (!customer) return;

  await sendNotification(
    ctx,
    orderId,
    `${orderId}_payment_failed`,
    customer.email,
    "Action required: Payment failed for your order",
    `Hi ${customer.name},\n\nUnfortunately, your payment for order ${orderId} could not be processed.\nReason: ${reason}\n\nYour order is currently on hold. Please update your payment details or contact support.`,
    logger,
  );
}

// ---------------------------------------------------------------------------
// Event: shipment.created — send shipped email with tracking number
// ---------------------------------------------------------------------------

async function handleShipmentCreated(
  data: ShipmentCreatedEventDetail["data"],
  requestId: string,
): Promise<void> {
  const { orderId, shipmentId, trackingNumber, provider } = data;
  const logger = createLogger(orderId, requestId);

  logger.info("Handling shipment.created for notifications", { orderId, shipmentId });

  const ctx = await init(logger);
  const customer = await requireCustomer(ctx, orderId, logger);
  if (!customer) return;

  await sendNotification(
    ctx,
    orderId,
    `${orderId}_shipment_created_${shipmentId}`,
    customer.email,
    "Your order has shipped!",
    `Hi ${customer.name},\n\nGreat news! Part of your order (${orderId}) has been shipped.\nTracking number: ${trackingNumber}\nCarrier: ${provider.toUpperCase()}\n\nYou can use this tracking number to follow your delivery.`,
    logger,
  );
}

// ---------------------------------------------------------------------------
// Event: inventory.failed — send out-of-stock notification email
// ---------------------------------------------------------------------------

async function handleInventoryFailed(
  data: InventoryFailedEventDetail["data"],
  requestId: string,
): Promise<void> {
  const { orderId, unavailableItems } = data;
  const logger = createLogger(orderId, requestId);

  logger.warn("Handling inventory.failed for notifications", { orderId });

  const ctx = await init(logger);
  const customer = await requireCustomer(ctx, orderId, logger);
  if (!customer) return;

  const itemList = unavailableItems
    .map((item) => `- Product ${item.productId}${item.variantId ? ` (variant: ${item.variantId})` : ""}: requested ${item.requestedQty}, available ${item.availableQty}`)
    .join("\n");

  await sendNotification(
    ctx,
    orderId,
    `${orderId}_inventory_failed`,
    customer.email,
    "We're sorry — some items in your order are out of stock",
    `Hi ${customer.name},\n\nUnfortunately, one or more items in your order (${orderId}) are currently out of stock:\n\n${itemList}\n\nYour order has been placed on hold. Please contact our support team to update your order or arrange a refund.`,
    logger,
  );
}

// ---------------------------------------------------------------------------
// Event: shipment.delivered — send delivery confirmation email
// ---------------------------------------------------------------------------

async function handleShipmentDelivered(
  data: ShipmentDeliveredEventDetail["data"],
  requestId: string,
): Promise<void> {
  const { orderId, shipmentId, trackingNumber } = data;
  const logger = createLogger(orderId, requestId);

  logger.info("Handling shipment.delivered for notifications", { orderId, shipmentId });

  const ctx = await init(logger);
  const customer = await requireCustomer(ctx, orderId, logger);
  if (!customer) return;

  await sendNotification(
    ctx,
    orderId,
    `${orderId}_shipment_delivered_${shipmentId}`,
    customer.email,
    "Your delivery has arrived!",
    `Hi ${customer.name},\n\nYour shipment (tracking: ${trackingNumber}) for order ${orderId} has been delivered.\n\nWe hope you enjoy your purchase! If you have any issues, please contact our support team.`,
    logger,
  );
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

  if (detailType === "payment.succeeded") {
    const event = envelope as EventBridgeEnvelope<PaymentSucceededEventDetail>;
    await handlePaymentSucceeded(event.detail.data, requestId);
    return;
  }

  if (detailType === "payment.failed") {
    const event = envelope as EventBridgeEnvelope<PaymentFailedEventDetail>;
    await handlePaymentFailed(event.detail.data, requestId);
    return;
  }

  if (detailType === "shipment.created") {
    const event = envelope as EventBridgeEnvelope<ShipmentCreatedEventDetail>;
    await handleShipmentCreated(event.detail.data, requestId);
    return;
  }

  if (detailType === "shipment.delivered") {
    const event = envelope as EventBridgeEnvelope<ShipmentDeliveredEventDetail>;
    await handleShipmentDelivered(event.detail.data, requestId);
    return;
  }

  if (detailType === "inventory.failed") {
    const event = envelope as EventBridgeEnvelope<InventoryFailedEventDetail>;
    await handleInventoryFailed(event.detail.data, requestId);
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
