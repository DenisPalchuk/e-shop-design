import { Db } from "mongodb";
import { OrderProjectionDocument } from "../types";
import { notFoundError } from "../../../shared/errors";
import { Logger } from "../../../shared/logger";

const COLLECTION = "shipment_order_projections";

export class OrderProjectionRepository {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  async upsert(projection: OrderProjectionDocument): Promise<void> {
    this.logger.info("Upserting order projection", { orderId: projection._id });
    await this.db
      .collection<OrderProjectionDocument>(COLLECTION)
      .updateOne(
        { _id: projection._id },
        { $setOnInsert: projection },
        { upsert: true },
      );
  }

  async findByOrderId(orderId: string): Promise<OrderProjectionDocument> {
    this.logger.info("Fetching order projection", { orderId });

    const projection = await this.db
      .collection<OrderProjectionDocument>(COLLECTION)
      .findOne({ _id: orderId });

    if (!projection) {
      this.logger.warn("Order projection not found", { orderId });
      throw notFoundError(`Order projection not found: ${orderId}`);
    }

    return projection;
  }
}
