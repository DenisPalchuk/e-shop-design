import { Db } from "mongodb";
import { Logger } from "../../shared/logger";

export class CircuitOpenError extends Error {
  constructor(provider: string) {
    super(`Circuit breaker open for provider: ${provider}`);
    this.name = "CircuitOpenError";
  }
}

type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreakerDocument {
  _id: string; // provider name e.g. "dhl", "fedex"
  state: CircuitState;
  failureCount: number;
  openedAt: string | null;
  updatedAt: string;
}

const COLLECTION = "circuit_breaker_state";

/**
 * MongoDB-backed circuit breaker, keyed by shipping provider name.
 * State is shared across Lambda invocations via the database.
 *
 * States:
 *   closed   — normal operation, calls pass through
 *   open     — failure threshold exceeded; calls fail fast until reset timeout elapses
 *   half-open — reset timeout elapsed; one probe call is allowed to test recovery
 */
export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(
    private readonly provider: string,
    private readonly db: Db,
    private readonly logger: Logger,
  ) {
    this.failureThreshold = parseInt(process.env.CIRCUIT_FAILURE_THRESHOLD ?? "5", 10);
    this.resetTimeoutMs = parseInt(process.env.CIRCUIT_RESET_TIMEOUT_MS ?? "60000", 10);
  }

  /**
   * Returns true if the circuit allows the call to proceed.
   *
   * The open → half-open transition uses a compare-and-set updateOne whose filter
   * includes { state: "open" }.  Only the first writer wins (matchedCount > 0);
   * every other Lambda that reads the same open document before this write lands
   * gets matchedCount=0 and is rejected — guaranteeing a single probe call.
   */
  async isAllowed(): Promise<boolean> {
    const doc = await this.getState();

    if (doc.state === "closed") return true;

    if (doc.state === "open") {
      const openedAt = doc.openedAt ? new Date(doc.openedAt).getTime() : 0;
      const elapsed = Date.now() - openedAt;

      if (elapsed < this.resetTimeoutMs) {
        this.logger.warn("Circuit breaker is open — rejecting call", {
          provider: this.provider,
          openedAt: doc.openedAt,
          resetTimeoutMs: this.resetTimeoutMs,
        });
        return false;
      }

      // Atomically claim the single probe slot.
      // The { state: "open" } predicate acts as the compare: if another Lambda has
      // already transitioned the document to "half-open", matchedCount will be 0.
      const result = await this.db
        .collection<CircuitBreakerDocument>(COLLECTION)
        .updateOne(
          { _id: this.provider, state: "open" },
          { $set: { state: "half-open", updatedAt: new Date().toISOString() } },
        );

      if (result.matchedCount > 0) {
        this.logger.info("Circuit breaker transitioning to half-open — probe slot claimed", {
          provider: this.provider,
        });
        return true;
      }

      // Lost the race — another caller already claimed the probe slot.
      this.logger.info("Circuit breaker probe slot already claimed — rejecting call", {
        provider: this.provider,
      });
      return false;
    }

    // half-open: a probe is already in-flight from whoever won the CAS above.
    // Block all other callers until that probe resolves.
    this.logger.info("Circuit breaker is half-open, probe in-flight — rejecting call", {
      provider: this.provider,
    });
    return false;
  }

  /** Called when a provider call succeeds — closes the circuit. */
  async recordSuccess(): Promise<void> {
    await this.setState("closed", 0, null);
    this.logger.info("Circuit breaker closed after successful call", { provider: this.provider });
  }

  /**
   * Called when a provider call fails — may open the circuit.
   *
   * Uses $inc for the failure count so every concurrent caller contributes
   * exactly 1 regardless of read/write ordering (no read-modify-write).
   * The open transition uses a CAS filter { state: "closed" } so only one
   * Lambda wins it even when multiple callers cross the threshold simultaneously.
   */
  async recordFailure(): Promise<void> {
    const now = new Date().toISOString();

    // If the circuit is already open or half-open (probe failed), keep it open
    // and refresh the timer. Targeted filter so this is a no-op when closed.
    const keptOpen = await this.db
      .collection<CircuitBreakerDocument>(COLLECTION)
      .updateOne(
        { _id: this.provider, state: { $in: ["open", "half-open"] } },
        { $set: { state: "open", openedAt: now, updatedAt: now } },
      );

    if (keptOpen.matchedCount > 0) {
      this.logger.warn("Circuit breaker remains open after failure", { provider: this.provider });
      return;
    }

    // Circuit is closed (or document does not yet exist).
    // $inc is atomic — no two callers can read the same count and write back the same value.
    // $setOnInsert initialises the document on the very first failure ever.
    const updated = await this.db
      .collection<CircuitBreakerDocument>(COLLECTION)
      .findOneAndUpdate(
        { _id: this.provider },
        {
          $inc: { failureCount: 1 },
          $set: { updatedAt: now },
          $setOnInsert: { state: "closed", openedAt: null },
        },
        { upsert: true, returnDocument: "after" },
      );

    const newCount = updated?.failureCount ?? 1;

    this.logger.warn("Circuit breaker failure recorded", {
      provider: this.provider,
      failureCount: newCount,
      threshold: this.failureThreshold,
    });

    if (newCount >= this.failureThreshold) {
      // CAS: only the first Lambda to see the threshold opens the circuit.
      // Others that also crossed the threshold will get matchedCount: 0 — harmless.
      const opened = await this.db
        .collection<CircuitBreakerDocument>(COLLECTION)
        .updateOne(
          { _id: this.provider, state: "closed" },
          { $set: { state: "open", openedAt: now, updatedAt: now } },
        );

      if (opened.matchedCount > 0) {
        this.logger.warn("Circuit breaker opened after failure threshold reached", {
          provider: this.provider,
          failureCount: newCount,
          threshold: this.failureThreshold,
        });
      }
    }
  }

  private async getState(): Promise<CircuitBreakerDocument> {
    const doc = await this.db
      .collection<CircuitBreakerDocument>(COLLECTION)
      .findOne({ _id: this.provider });

    return (
      doc ?? {
        _id: this.provider,
        state: "closed",
        failureCount: 0,
        openedAt: null,
        updatedAt: new Date().toISOString(),
      }
    );
  }

  private async setState(
    state: CircuitState,
    failureCount: number,
    openedAt: string | null,
  ): Promise<void> {
    await this.db.collection<CircuitBreakerDocument>(COLLECTION).updateOne(
      { _id: this.provider },
      { $set: { state, failureCount, openedAt, updatedAt: new Date().toISOString() } },
      { upsert: true },
    );
  }
}
