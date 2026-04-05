import { ClientSession, Db } from "mongodb";
import { OrderDocument, ShipmentSummary } from "../types";
import { notFoundError } from "../../../shared/errors";
import { Logger } from "../../../shared/logger";

const COLLECTION = "orders";

export class OrderRepository {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  async insert(order: OrderDocument, session?: ClientSession): Promise<void> {
    this.logger.info("Inserting order into MongoDB", { orderId: order._id });
    await this.db.collection<OrderDocument>(COLLECTION).insertOne(order, { session });
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

  async updateStatus(orderId: string, status: OrderDocument["status"]): Promise<void> {
    this.logger.info("Updating order status", { orderId, status });
    await this.db.collection<OrderDocument>(COLLECTION).updateOne(
      { _id: orderId },
      {
        $set: { status, updatedAt: new Date().toISOString() },
        $push: { statusHistory: { status, timestamp: new Date().toISOString() } },
      },
    );
    this.logger.info("Order status updated", { orderId, status });
  }

  async addShipment(orderId: string, shipment: ShipmentSummary): Promise<void> {
    this.logger.info("Adding shipment to order", { orderId, shipmentId: shipment.shipmentId });
    await this.db.collection<OrderDocument>(COLLECTION).updateOne(
      { _id: orderId },
      {
        $push: { shipments: shipment },
        $set: { updatedAt: new Date().toISOString() },
      },
    );
  }

  async markShipmentDelivered(
    orderId: string,
    shipmentId: string,
    deliveredAt: string,
  ): Promise<void> {
    this.logger.info("Marking shipment delivered on order", { orderId, shipmentId });
    await this.db.collection<OrderDocument>(COLLECTION).updateOne(
      { _id: orderId, "shipments.shipmentId": shipmentId },
      {
        $set: {
          "shipments.$.status": "delivered",
          "shipments.$.deliveredAt": deliveredAt,
          updatedAt: new Date().toISOString(),
        },
      },
    );
  }
}
