import { Db } from "mongodb";
import { InventoryCheckDocument } from "../types";
import { Logger } from "../../../shared/logger";

const COLLECTION = "inventory_checks";

export class InventoryRepository {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  async insert(check: InventoryCheckDocument): Promise<void> {
    this.logger.info("Inserting inventory check record", {
      checkId: check._id,
      orderId: check.orderId,
    });
    await this.db.collection<InventoryCheckDocument>(COLLECTION).insertOne(check);
    this.logger.info("Inventory check record inserted", { checkId: check._id });
  }

  async findByOrderId(orderId: string): Promise<InventoryCheckDocument | null> {
    return this.db
      .collection<InventoryCheckDocument>(COLLECTION)
      .findOne({ orderId });
  }
}
