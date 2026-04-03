import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { OrderDocument, OrderCreatedEventDetail } from "../types";
import { generateEventId } from "../../../shared/ids";
import { Logger } from "../../../shared/logger";

export class OrderEvents {
  constructor(
    private readonly busName: string,
    private readonly client: EventBridgeClient,
    private readonly logger: Logger,
  ) {}

  async publishOrderCreated(order: OrderDocument): Promise<void> {
    const eventId = generateEventId();
    const now = new Date().toISOString();

    const detail: OrderCreatedEventDetail = {
      metadata: {
        eventId,
        timestamp: now,
        correlationId: order._id,
        version: "1.0",
      },
      data: {
        orderId: order._id,
        items: order.items,
        customer: {
          name: order.customer.name,
          email: order.customer.email,
          shippingAddress: order.customer.shippingAddress,
        },
        shippingMethod: order.shippingMethod,
        paymentDetails: {
          provider: order.paymentProvider,
          token: order.paymentToken,
        },
      },
    };

    this.logger.info("Publishing order.created event to EventBridge", {
      orderId: order._id,
      eventId,
      busName: this.busName,
    });

    const command = new PutEventsCommand({
      Entries: [
        {
          EventBusName: this.busName,
          Source: "checkout.order-service",
          DetailType: "order.created",
          Detail: JSON.stringify(detail),
          Time: new Date(),
        },
      ],
    });

    const result = await this.client.send(command);

    if (result.FailedEntryCount && result.FailedEntryCount > 0) {
      const failed = result.Entries?.filter((e) => e.ErrorCode);
      this.logger.error("EventBridge PutEvents partially failed", {
        orderId: order._id,
        eventId,
        failedEntries: failed,
      });
      throw new Error(
        `Failed to publish order.created event: ${failed?.[0]?.ErrorMessage ?? "unknown error"}`,
      );
    }

    this.logger.info("order.created event published successfully", {
      orderId: order._id,
      eventId,
    });
  }
}
