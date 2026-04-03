import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { InvoiceDocument, InvoiceGeneratedEventDetail } from "../types";
import { generateEventId } from "../../../shared/ids";
import { Logger } from "../../../shared/logger";

export class InvoiceEvents {
  constructor(
    private readonly busName: string,
    private readonly client: EventBridgeClient,
    private readonly logger: Logger,
  ) {}

  async publishInvoiceGenerated(invoice: InvoiceDocument): Promise<void> {
    const eventId = generateEventId();
    const now = new Date().toISOString();

    const detail: InvoiceGeneratedEventDetail = {
      metadata: {
        eventId,
        timestamp: now,
        correlationId: invoice.orderId,
        version: "1.0",
      },
      data: {
        orderId: invoice.orderId,
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
      },
    };

    this.logger.info("Publishing invoice.generated event to EventBridge", {
      orderId: invoice.orderId,
      invoiceId: invoice._id,
      eventId,
      busName: this.busName,
    });

    const command = new PutEventsCommand({
      Entries: [
        {
          EventBusName: this.busName,
          Source: "checkout.invoice-service",
          DetailType: "invoice.generated",
          Detail: JSON.stringify(detail),
          Time: new Date(),
        },
      ],
    });

    const result = await this.client.send(command);

    if (result.FailedEntryCount && result.FailedEntryCount > 0) {
      const failed = result.Entries?.filter((e) => e.ErrorCode);
      this.logger.error("EventBridge PutEvents partially failed", {
        orderId: invoice.orderId,
        eventId,
        failedEntries: failed,
      });
      throw new Error(
        `Failed to publish invoice.generated event: ${failed?.[0]?.ErrorMessage ?? "unknown error"}`,
      );
    }

    this.logger.info("invoice.generated event published successfully", {
      orderId: invoice.orderId,
      invoiceId: invoice._id,
      eventId,
    });
  }
}
