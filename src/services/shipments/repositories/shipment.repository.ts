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

  async ensureIndexes(): Promise<void> {
    await this.db.collection<ShipmentDocument>(COLLECTION).createIndex(
      { orderId: 1, groupIndex: 1 },
      { unique: true, name: "orderId_groupIndex_unique" },
    );
  }

  /**
   * Inserts the shipment only if no document with the same (orderId, groupIndex) exists.
   * Returns true when the document was inserted, false when it already existed.
   * Handles the duplicate-key race that can occur when two Lambda invocations run concurrently.
   */
  async insertIfAbsent(shipment: ShipmentDocument): Promise<boolean> {
    this.logger.info("Inserting shipment record if absent", {
      shipmentId: shipment._id,
      orderId: shipment.orderId,
      groupIndex: shipment.groupIndex,
    });

    try {
      const result = await this.db.collection<ShipmentDocument>(COLLECTION).updateOne(
        { orderId: shipment.orderId, groupIndex: shipment.groupIndex },
        { $setOnInsert: shipment },
        { upsert: true },
      );

      const inserted = result.upsertedCount > 0;
      this.logger.info(inserted ? "Shipment record inserted" : "Shipment already exists — skipping", {
        shipmentId: shipment._id,
        orderId: shipment.orderId,
        groupIndex: shipment.groupIndex,
      });
      return inserted;
    } catch (err: unknown) {
      // Two concurrent invocations can both attempt the upsert before either lands.
      // The unique index makes the second one throw E11000; treat it as "already exists".
      if (err instanceof Error && "code" in err && (err as { code: number }).code === 11000) {
        this.logger.info("Duplicate key on concurrent insert — treating as already exists", {
          orderId: shipment.orderId,
          groupIndex: shipment.groupIndex,
        });
        return false;
      }
      throw err;
    }
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

  async updateHeld(shipmentId: string, retryCount: number): Promise<void> {
    this.logger.warn("Marking shipment as held", { shipmentId, retryCount });
    await this.db.collection<ShipmentDocument>(COLLECTION).updateOne(
      { _id: shipmentId },
      {
        $set: {
          status: "held",
          retryCount,
          circuitState: "open",
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
