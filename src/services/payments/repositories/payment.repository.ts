import { Db } from "mongodb";
import { PaymentDocument, PaymentStatus } from "../types";
import { notFoundError } from "../../../shared/errors";
import { Logger } from "../../../shared/logger";

const COLLECTION = "payments";

export class PaymentRepository {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  async insert(payment: PaymentDocument): Promise<void> {
    this.logger.info("Inserting payment record", {
      paymentId: payment._id,
      orderId: payment.orderId,
    });
    await this.db.collection<PaymentDocument>(COLLECTION).insertOne(payment);
    this.logger.info("Payment record inserted", { paymentId: payment._id });
  }

  async findByOrderId(orderId: string): Promise<PaymentDocument> {
    this.logger.info("Fetching payment by orderId", { orderId });

    const payment = await this.db
      .collection<PaymentDocument>(COLLECTION)
      .findOne({ orderId });

    if (!payment) {
      this.logger.warn("Payment not found for order", { orderId });
      throw notFoundError(`Payment not found for order: ${orderId}`);
    }

    return payment;
  }

  async updateStatus(
    paymentId: string,
    status: PaymentStatus,
    fields: { transactionRef?: string; failureReason?: string },
  ): Promise<void> {
    const now = new Date().toISOString();
    this.logger.info("Updating payment status", { paymentId, status });

    await this.db.collection<PaymentDocument>(COLLECTION).updateOne(
      { _id: paymentId },
      { $set: { status, updatedAt: now, ...fields } },
    );
  }
}
