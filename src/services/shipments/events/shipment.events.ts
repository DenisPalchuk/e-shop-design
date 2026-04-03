import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import {
  ShipmentDocument,
  ShipmentCreatedEventDetail,
  ShipmentDeliveredEventDetail,
} from "../types";
import { generateEventId } from "../../../shared/ids";
import { Logger } from "../../../shared/logger";

export class ShipmentEvents {
  constructor(
    private readonly busName: string,
    private readonly client: EventBridgeClient,
    private readonly logger: Logger,
  ) {}

  async publishShipmentCreated(shipment: ShipmentDocument): Promise<void> {
    const eventId = generateEventId();

    const detail: ShipmentCreatedEventDetail = {
      metadata: {
        eventId,
        timestamp: new Date().toISOString(),
        correlationId: shipment.orderId,
        version: "1.0",
      },
      data: {
        orderId: shipment.orderId,
        shipmentId: shipment._id,
        trackingNumber: shipment.trackingNumber!,
        provider: shipment.provider,
        items: shipment.items,
      },
    };

    await this.publish("shipment.created", detail, shipment.orderId, eventId);
  }

  async publishShipmentDelivered(shipment: ShipmentDocument): Promise<void> {
    const eventId = generateEventId();

    const detail: ShipmentDeliveredEventDetail = {
      metadata: {
        eventId,
        timestamp: new Date().toISOString(),
        correlationId: shipment.orderId,
        version: "1.0",
      },
      data: {
        orderId: shipment.orderId,
        shipmentId: shipment._id,
        trackingNumber: shipment.trackingNumber!,
        deliveredAt: shipment.deliveredAt!,
      },
    };

    await this.publish("shipment.delivered", detail, shipment.orderId, eventId);
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
          Source: "checkout.shipment-service",
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
