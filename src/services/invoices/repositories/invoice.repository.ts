import { Db } from "mongodb";
import { CounterDocument, InvoiceDocument } from "../types";
import { notFoundError } from "../../../shared/errors";
import { Logger } from "../../../shared/logger";

const COLLECTION = "invoices";
const COUNTERS_COLLECTION = "counters";

export class InvoiceRepository {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  /**
   * Atomically increment and return the next invoice number for the current year.
   * Format: INV-{YEAR}-{6-digit-zero-padded-sequence}
   */
  async nextInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const counterId = `invoice_${year}`;

    this.logger.debug("Incrementing invoice counter", { counterId });

    const result = await this.db
      .collection<CounterDocument>(COUNTERS_COLLECTION)
      .findOneAndUpdate(
        { _id: counterId },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: "after" },
      );

    const seq = result!.seq;
    const invoiceNumber = `INV-${year}-${String(seq).padStart(6, "0")}`;

    this.logger.debug("Invoice number generated", { invoiceNumber });
    return invoiceNumber;
  }

  async insert(invoice: InvoiceDocument): Promise<void> {
    this.logger.info("Inserting invoice into MongoDB", {
      invoiceId: invoice._id,
      orderId: invoice.orderId,
    });
    await this.db.collection<InvoiceDocument>(COLLECTION).insertOne(invoice);
    this.logger.info("Invoice inserted successfully", {
      invoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
    });
  }

  async findByOrderId(orderId: string): Promise<InvoiceDocument> {
    this.logger.info("Fetching invoice from MongoDB", { orderId });

    const invoice = await this.db
      .collection<InvoiceDocument>(COLLECTION)
      .findOne({ orderId });

    if (!invoice) {
      this.logger.warn("Invoice not found for order", { orderId });
      throw notFoundError(`Invoice not found for order: ${orderId}`);
    }

    this.logger.info("Invoice fetched successfully", {
      invoiceId: invoice._id,
      orderId,
    });
    return invoice;
  }
}
