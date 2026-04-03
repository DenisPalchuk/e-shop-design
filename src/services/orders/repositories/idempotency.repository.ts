import { ClientSession, Db } from "mongodb";
import {
  CreateOrderResponse,
  IdempotencyDocument,
  PendingIdempotencyDocument,
} from "../types";
import { Logger } from "../../../shared/logger";

const COLLECTION = "order_idempotency";
const DEFAULT_DEBOUNCE_MINUTES = 5;
const DEFAULT_PROCESSING_LEASE_MS = 5_000;
const DEFAULT_WAIT_TIMEOUT_MS = 1_500;
const DEFAULT_WAIT_POLL_MS = 50;

export type IdempotencyClaimResult =
  | { kind: "claimed" }
  | { kind: "completed"; response: CreateOrderResponse; orderId: string }
  | { kind: "pending" }
  | { kind: "stale_pending" };

export type IdempotencyWaitResult =
  | { kind: "completed"; response: CreateOrderResponse; orderId: string }
  | { kind: "pending" }
  | { kind: "stale_pending" }
  | { kind: "missing" };

function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getDebounceWindowMs(): number {
  return parsePositiveIntEnv(process.env.DEBOUNCE_WINDOW_MINUTES, DEFAULT_DEBOUNCE_MINUTES) * 60 * 1000;
}

function getProcessingLeaseMs(): number {
  return parsePositiveIntEnv(process.env.IDEMPOTENCY_PROCESSING_LEASE_MS, DEFAULT_PROCESSING_LEASE_MS);
}

function getWaitTimeoutMs(): number {
  return parsePositiveIntEnv(process.env.IDEMPOTENCY_WAIT_TIMEOUT_MS, DEFAULT_WAIT_TIMEOUT_MS);
}

function getWaitPollMs(): number {
  return parsePositiveIntEnv(process.env.IDEMPOTENCY_WAIT_POLL_MS, DEFAULT_WAIT_POLL_MS);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class IdempotencyRepository {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  private collection() {
    return this.db.collection<IdempotencyDocument>(COLLECTION);
  }

  private buildPendingDocument(
    key: string,
    requestId: string,
    now = new Date(),
  ): PendingIdempotencyDocument {
    return {
      _id: key,
      status: "pending",
      requestId,
      createdAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + getProcessingLeaseMs()).toISOString(),
      expiresAt: new Date(now.getTime() + getDebounceWindowMs()).toISOString(),
    };
  }

  private isExpired(record: IdempotencyDocument, now = new Date()): boolean {
    return new Date(record.expiresAt).getTime() <= now.getTime();
  }

  private isLeaseExpired(record: IdempotencyDocument, now = new Date()): boolean {
    return new Date(record.leaseExpiresAt).getTime() <= now.getTime();
  }

  private classifyExistingRecord(
    record: IdempotencyDocument,
    now = new Date(),
  ): IdempotencyClaimResult {
    if (record.status === "completed") {
      return {
        kind: "completed",
        response: record.response,
        orderId: record.orderId,
      };
    }

    if (this.isLeaseExpired(record, now)) {
      return { kind: "stale_pending" };
    }

    return { kind: "pending" };
  }

  private async deleteExpiredRecord(record: IdempotencyDocument): Promise<void> {
    await this.collection().deleteOne({
      _id: record._id,
      expiresAt: record.expiresAt,
    });
  }

  async claimOrGet(
    key: string,
    requestId: string,
    attempt = 0,
  ): Promise<IdempotencyClaimResult> {
    const now = new Date();
    const pending = this.buildPendingDocument(key, requestId, now);

    this.logger.debug("Attempting to claim idempotency key", {
      idempotencyKey: key,
      requestId,
      attempt,
    });

    try {
      await this.collection().insertOne(pending);
      this.logger.info("Claimed idempotency key", { idempotencyKey: key, requestId });
      return { kind: "claimed" };
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }

    const existing = await this.collection().findOne({ _id: key });

    if (!existing) {
      if (attempt >= 2) {
        return { kind: "pending" };
      }

      return this.claimOrGet(key, requestId, attempt + 1);
    }

    if (this.isExpired(existing, now)) {
      this.logger.info("Found expired idempotency record while claiming", {
        idempotencyKey: key,
        status: existing.status,
      });
      await this.deleteExpiredRecord(existing);

      if (attempt >= 2) {
        return { kind: "pending" };
      }

      return this.claimOrGet(key, requestId, attempt + 1);
    }

    const result = this.classifyExistingRecord(existing, now);
    this.logger.debug("Idempotency key already exists", {
      idempotencyKey: key,
      requestId,
      result: result.kind,
    });
    return result;
  }

  async takeOverIfStale(key: string, requestId: string): Promise<boolean> {
    const now = new Date();
    const nextLeaseExpiresAt = new Date(now.getTime() + getProcessingLeaseMs()).toISOString();
    const nextExpiresAt = new Date(now.getTime() + getDebounceWindowMs()).toISOString();

    this.logger.info("Attempting stale idempotency takeover", {
      idempotencyKey: key,
      requestId,
    });

    const result = await this.collection().updateOne(
      {
        _id: key,
        status: "pending",
        leaseExpiresAt: { $lte: now.toISOString() },
      },
      {
        $set: {
          requestId,
          leaseExpiresAt: nextLeaseExpiresAt,
          expiresAt: nextExpiresAt,
        },
      },
    );

    const claimed = result.modifiedCount === 1;

    this.logger.info("Stale idempotency takeover result", {
      idempotencyKey: key,
      requestId,
      claimed,
    });

    return claimed;
  }

  async waitForCompletion(
    key: string,
    waitTimeoutMs = getWaitTimeoutMs(),
    pollIntervalMs = getWaitPollMs(),
  ): Promise<IdempotencyWaitResult> {
    const deadline = Date.now() + waitTimeoutMs;

    while (true) {
      const now = new Date();
      const record = await this.collection().findOne({ _id: key });

      if (!record) {
        this.logger.info("Pending idempotency key cleared before completion", {
          idempotencyKey: key,
        });
        return { kind: "missing" };
      }

      if (this.isExpired(record, now)) {
        await this.deleteExpiredRecord(record);
        this.logger.info("Idempotency record expired while waiting", {
          idempotencyKey: key,
          status: record.status,
        });
        return { kind: "missing" };
      }

      if (record.status === "completed") {
        this.logger.info("Observed completed idempotency response while waiting", {
          idempotencyKey: key,
          orderId: record.orderId,
        });
        return {
          kind: "completed",
          response: record.response,
          orderId: record.orderId,
        };
      }

      if (this.isLeaseExpired(record, now)) {
        this.logger.info("Pending idempotency key became stale while waiting", {
          idempotencyKey: key,
        });
        return { kind: "stale_pending" };
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        this.logger.warn("Timed out waiting for idempotency completion", {
          idempotencyKey: key,
          waitTimeoutMs,
        });
        return { kind: "pending" };
      }

      await sleep(Math.min(pollIntervalMs, remainingMs));
    }
  }

  async complete(
    key: string,
    requestId: string,
    orderId: string,
    response: CreateOrderResponse,
    session?: ClientSession,
  ): Promise<void> {
    const now = new Date();

    this.logger.debug("Completing idempotency record", {
      idempotencyKey: key,
      requestId,
      orderId,
    });

    const result = await this.collection().updateOne(
      {
        _id: key,
        status: "pending",
        requestId,
      },
      {
        $set: {
          status: "completed",
          orderId,
          response,
          leaseExpiresAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + getDebounceWindowMs()).toISOString(),
        },
      },
      { session },
    );

    if (result.matchedCount !== 1) {
      throw new Error(`Failed to complete idempotency record for key ${key}`);
    }

    this.logger.info("Completed idempotency record", {
      idempotencyKey: key,
      requestId,
      orderId,
    });
  }

  async releasePending(key: string, requestId: string): Promise<void> {
    this.logger.info("Releasing pending idempotency record", {
      idempotencyKey: key,
      requestId,
    });

    await this.collection().deleteOne({
      _id: key,
      status: "pending",
      requestId,
    });
  }
}
