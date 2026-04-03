import { Db } from "mongodb";
import { IdempotencyDocument, CreateOrderResponse } from "../types";
import { Logger } from "../../../shared/logger";

const COLLECTION = "order_idempotency";
const DEFAULT_DEBOUNCE_MINUTES = 5;

function getDebounceWindowMs(): number {
  const raw = process.env.DEBOUNCE_WINDOW_MINUTES;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  const minutes = isNaN(parsed) ? DEFAULT_DEBOUNCE_MINUTES : parsed;
  return minutes * 60 * 1000;
}

export class IdempotencyRepository {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  /**
   * Look up an existing idempotency record.
   * Returns the cached response if the key exists and has not expired;
   * returns null otherwise.
   */
  async check(key: string): Promise<CreateOrderResponse | null> {
    this.logger.debug("Checking idempotency record", { idempotencyKey: key });

    const record = await this.db
      .collection<IdempotencyDocument>(COLLECTION)
      .findOne({ _id: key });

    if (!record) {
      this.logger.debug("No idempotency record found", { idempotencyKey: key });
      return null;
    }

    const now = Date.now();
    const expiresAt = new Date(record.expiresAt).getTime();

    if (now > expiresAt) {
      // Expired — treat as a new request; the TTL index will clean it up
      this.logger.info("Idempotency record found but expired", {
        idempotencyKey: key,
        expiresAt: record.expiresAt,
      });
      return null;
    }

    this.logger.info("Duplicate request detected — returning cached response", {
      idempotencyKey: key,
      orderId: record.orderId,
    });
    return record.response;
  }

  /**
   * Persist a new idempotency record after successful order creation.
   */
  async store(key: string, orderId: string, response: CreateOrderResponse): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + getDebounceWindowMs());

    const doc: IdempotencyDocument = {
      _id: key,
      orderId,
      response,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    this.logger.debug("Storing idempotency record", { idempotencyKey: key, orderId });

    // Use upsert to be safe against rare race conditions
    await this.db
      .collection<IdempotencyDocument>(COLLECTION)
      .updateOne({ _id: key }, { $setOnInsert: doc }, { upsert: true });

    this.logger.debug("Idempotency record stored", { idempotencyKey: key, orderId });
  }
}
