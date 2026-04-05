import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import {
  InventoryCheckDocument,
  InventoryConfirmedEventDetail,
  InventoryFailedEventDetail,
} from "../types";
import { generateEventId } from "../../../shared/ids";
import { Logger } from "../../../shared/logger";

export class InventoryEvents {
  constructor(
    private readonly busName: string,
    private readonly client: EventBridgeClient,
    private readonly logger: Logger,
  ) {}

  async publishInventoryConfirmed(check: InventoryCheckDocument): Promise<void> {
    const eventId = generateEventId();

    const detail: InventoryConfirmedEventDetail = {
      metadata: {
        eventId,
        timestamp: new Date().toISOString(),
        correlationId: check.orderId,
        version: "1.0",
      },
      data: {
        orderId: check.orderId,
        checkId: check._id,
      },
    };

    await this.publish("inventory.confirmed", detail, check.orderId, eventId);
  }

  async publishInventoryFailed(check: InventoryCheckDocument): Promise<void> {
    const eventId = generateEventId();

    const detail: InventoryFailedEventDetail = {
      metadata: {
        eventId,
        timestamp: new Date().toISOString(),
        correlationId: check.orderId,
        version: "1.0",
      },
      data: {
        orderId: check.orderId,
        checkId: check._id,
        unavailableItems: check.unavailableItems,
      },
    };

    await this.publish("inventory.failed", detail, check.orderId, eventId);
  }

  private async publish(
    detailType: string,
    detail: object,
    orderId: string,
    eventId: string,
  ): Promise<void> {
    this.logger.info(`Publishing ${detailType} event`, {
      orderId,
      eventId,
      busName: this.busName,
    });

    const command = new PutEventsCommand({
      Entries: [
        {
          EventBusName: this.busName,
          Source: "checkout.inventory-service",
          DetailType: detailType,
          Detail: JSON.stringify(detail),
          Time: new Date(),
        },
      ],
    });

    const result = await this.client.send(command);

    if (result.FailedEntryCount && result.FailedEntryCount > 0) {
      const failed = result.Entries?.filter((e) => e.ErrorCode);
      this.logger.error(`EventBridge PutEvents failed for ${detailType}`, {
        orderId,
        eventId,
        failedEntries: failed,
      });
      throw new Error(
        `Failed to publish ${detailType}: ${failed?.[0]?.ErrorMessage ?? "unknown error"}`,
      );
    }

    this.logger.info(`${detailType} event published successfully`, { orderId, eventId });
  }
}
