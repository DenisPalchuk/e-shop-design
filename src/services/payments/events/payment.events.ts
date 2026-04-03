import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import {
  PaymentDocument,
  PaymentSucceededEventDetail,
  PaymentFailedEventDetail,
} from "../types";
import { generateEventId } from "../../../shared/ids";
import { Logger } from "../../../shared/logger";

export class PaymentEvents {
  constructor(
    private readonly busName: string,
    private readonly client: EventBridgeClient,
    private readonly logger: Logger,
  ) {}

  async publishPaymentSucceeded(payment: PaymentDocument): Promise<void> {
    const eventId = generateEventId();

    const detail: PaymentSucceededEventDetail = {
      metadata: {
        eventId,
        timestamp: new Date().toISOString(),
        correlationId: payment.orderId,
        version: "1.0",
      },
      data: {
        orderId: payment.orderId,
        paymentId: payment._id,
        transactionRef: payment.transactionRef!,
      },
    };

    await this.publish("payment.succeeded", detail, payment.orderId, eventId);
  }

  async publishPaymentFailed(payment: PaymentDocument): Promise<void> {
    const eventId = generateEventId();

    const detail: PaymentFailedEventDetail = {
      metadata: {
        eventId,
        timestamp: new Date().toISOString(),
        correlationId: payment.orderId,
        version: "1.0",
      },
      data: {
        orderId: payment.orderId,
        paymentId: payment._id,
        reason: payment.failureReason ?? "Unknown payment failure",
      },
    };

    await this.publish("payment.failed", detail, payment.orderId, eventId);
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
          Source: "checkout.payment-service",
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
