import { Db } from "mongodb";
import { OrderDocument } from "../types";
import { notFoundError } from "../../../shared/errors";
import { Logger } from "../../../shared/logger";

const COLLECTION = "orders";

export class OrderRepository {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  async insert(order: OrderDocument): Promise<void> {
    this.logger.info("Inserting order into MongoDB", { orderId: order._id });
    await this.db.collection<OrderDocument>(COLLECTION).insertOne(order);
    this.logger.info("Order inserted successfully", { orderId: order._id });
  }

  async findById(orderId: string): Promise<OrderDocument> {
    this.logger.info("Fetching order from MongoDB", { orderId });

    const order = await this.db
      .collection<OrderDocument>(COLLECTION)
      .findOne({ _id: orderId });

    if (!order) {
      this.logger.warn("Order not found", { orderId });
      throw notFoundError(`Order not found: ${orderId}`);
    }

    this.logger.info("Order fetched successfully", { orderId });
    return order;
  }
}
