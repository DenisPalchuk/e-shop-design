import { Db } from "mongodb";
import { ShipmentDocument } from "../types";
import { notFoundError } from "../../../shared/errors";
import { Logger } from "../../../shared/logger";

const COLLECTION = "shipments";

export class ShipmentRepository {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  async insert(shipment: ShipmentDocument): Promise<void> {
    this.logger.info("Inserting shipment record", {
      shipmentId: shipment._id,
      orderId: shipment.orderId,
    });
    await this.db.collection<ShipmentDocument>(COLLECTION).insertOne(shipment);
    this.logger.info("Shipment record inserted", {
      shipmentId: shipment._id,
      trackingNumber: shipment.trackingNumber,
    });
  }

  async findByTrackingNumber(trackingNumber: string): Promise<ShipmentDocument> {
    this.logger.info("Fetching shipment by tracking number", { trackingNumber });

    const shipment = await this.db
      .collection<ShipmentDocument>(COLLECTION)
      .findOne({ trackingNumber });

    if (!shipment) {
      this.logger.warn("Shipment not found for tracking number", { trackingNumber });
      throw notFoundError(`Shipment not found for tracking number: ${trackingNumber}`);
    }

    return shipment;
  }

  async updateTrackingNumber(
    shipmentId: string,
    trackingNumber: string,
    shippedAt: string,
  ): Promise<void> {
    this.logger.info("Updating shipment with tracking number", { shipmentId, trackingNumber });
    await this.db.collection<ShipmentDocument>(COLLECTION).updateOne(
      { _id: shipmentId },
      {
        $set: {
          trackingNumber,
          shippedAt,
          status: "in_transit",
          updatedAt: new Date().toISOString(),
        },
      },
    );
  }

  async updateDelivered(shipmentId: string, deliveredAt: string): Promise<void> {
    this.logger.info("Marking shipment as delivered", { shipmentId });
    await this.db.collection<ShipmentDocument>(COLLECTION).updateOne(
      { _id: shipmentId },
      {
        $set: {
          status: "delivered",
          deliveredAt,
          updatedAt: new Date().toISOString(),
        },
      },
    );
  }
}
