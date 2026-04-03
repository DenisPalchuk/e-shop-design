import { getDb } from "../../shared/db";
import { getEventBridgeClient, DEFAULT_BUS_NAME } from "../../shared/eventbridge";
import { Logger } from "../../shared/logger";
import { InvoiceRepository } from "./repositories/invoice.repository";
import { InvoiceEvents } from "./events/invoice.events";

export interface InvoicesContext {
  invoiceRepository: InvoiceRepository;
  invoiceEvents: InvoiceEvents;
}

export async function init(logger: Logger): Promise<InvoicesContext> {
  const db = await getDb();

  return {
    invoiceRepository: new InvoiceRepository(db, logger),
    invoiceEvents: new InvoiceEvents(
      process.env.EVENTBRIDGE_BUS_NAME ?? DEFAULT_BUS_NAME,
      getEventBridgeClient(),
      logger,
    ),
  };
}
