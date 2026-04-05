import { SQSEvent, SQSRecord } from "aws-lambda";
import { init } from "./context";
import { InventoryCheckDocument, OrderCreatedEventDetail } from "./types";
import { createLogger } from "../../shared/logger";
import { generateInventoryCheckId, generateRequestId } from "../../shared/ids";

type EventBridgeEnvelope<T> = { "detail-type": string; detail: T };

// ---------------------------------------------------------------------------
// Event: order.created — check inventory and emit confirmed or failed
// ---------------------------------------------------------------------------

async function handleOrderCreated(
  data: OrderCreatedEventDetail["data"],
  requestId: string,
): Promise<void> {
  const { orderId, items } = data;
  const logger = createLogger(orderId, requestId);

  logger.info("Checking inventory for order", { orderId, itemCount: items.length });

  const { inventoryRepository, inventoryEvents, inventoryProvider } = await init(logger);

  // Idempotency: skip if already processed
  const existing = await inventoryRepository.findByOrderId(orderId);
  if (existing) {
    logger.info("Inventory already checked for order, skipping", {
      orderId,
      checkId: existing._id,
      status: existing.status,
    });
    return;
  }

  const result = await inventoryProvider.checkStock({ items });

  const check: InventoryCheckDocument = {
    _id: generateInventoryCheckId(),
    orderId,
    status: result.allInStock ? "confirmed" : "failed",
    unavailableItems: result.unavailableItems,
    checkedAt: new Date().toISOString(),
  };

  await inventoryRepository.insert(check);

  if (result.allInStock) {
    logger.info("Inventory confirmed for order", { orderId, checkId: check._id });
    await inventoryEvents.publishInventoryConfirmed(check);
  } else {
    logger.warn("Inventory check failed for order — items out of stock", {
      orderId,
      checkId: check._id,
      unavailableItems: result.unavailableItems,
    });
    await inventoryEvents.publishInventoryFailed(check);
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
