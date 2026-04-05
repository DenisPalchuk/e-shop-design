import { Db } from "mongodb";
import { NotificationDocument } from "../types";
import { Logger } from "../../../shared/logger";

const COLLECTION = "notifications";

export class NotificationRepository {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  async existsByIdempotencyKey(idempotencyKey: string): Promise<boolean> {
    const existing = await this.db
      .collection<NotificationDocument>(COLLECTION)
      .findOne({ idempotencyKey });
    return existing !== null;
  }

  async insert(notification: NotificationDocument): Promise<void> {
    this.logger.info("Inserting notification record", {
      notificationId: notification._id,
      orderId: notification.orderId,
      idempotencyKey: notification.idempotencyKey,
    });

    await this.db.collection<NotificationDocument>(COLLECTION).insertOne(notification);

    this.logger.info("Notification record inserted", { notificationId: notification._id });
  }
}
