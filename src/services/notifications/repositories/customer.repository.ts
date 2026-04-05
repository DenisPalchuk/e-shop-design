import { Db } from "mongodb";
import { CustomerProjectionDocument } from "../types";
import { Logger } from "../../../shared/logger";

const COLLECTION = "notification_customers";

export class CustomerRepository {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  async upsert(projection: CustomerProjectionDocument): Promise<void> {
    this.logger.info("Upserting customer projection", { orderId: projection._id });

    await this.db
      .collection<CustomerProjectionDocument>(COLLECTION)
      .replaceOne({ _id: projection._id }, projection, { upsert: true });

    this.logger.info("Customer projection stored", { orderId: projection._id });
  }

  async findByOrderId(orderId: string): Promise<CustomerProjectionDocument | null> {
    this.logger.info("Looking up customer projection", { orderId });
    return this.db
      .collection<CustomerProjectionDocument>(COLLECTION)
      .findOne({ _id: orderId });
  }
}
