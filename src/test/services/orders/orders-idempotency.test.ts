import assert from "node:assert/strict";
import test from "node:test";
import { handleCreateOrder } from "../../../services/orders/handler";
import { IdempotencyRepository } from "../../../services/orders/repositories/idempotency.repository";
import {
  createCompletedOrderResponse,
  createOrderEvent,
} from "../../fixtures/orders";
import { InMemoryDb } from "../../helpers/in-memory-db";
import {
  buildOrdersHarness,
  silentLogger,
} from "../../helpers/orders-harness";
import {
  delay,
  handleCreateOrderResult,
  parseBody,
  withEnv,
} from "../../helpers/test-utils";

test("idempotency repository claims once and replays completed responses", async () => {
  await withEnv(
    {
      IDEMPOTENCY_PROCESSING_LEASE_MS: 50,
      IDEMPOTENCY_WAIT_TIMEOUT_MS: 25,
      IDEMPOTENCY_WAIT_POLL_MS: 5,
    },
    async () => {
      const db = new InMemoryDb();
      const repository = new IdempotencyRepository(db as never, silentLogger);
      const response = createCompletedOrderResponse();

      assert.deepEqual(await repository.claimOrGet("idem-1", "req-1"), {
        kind: "claimed",
      });
      assert.deepEqual(await repository.claimOrGet("idem-1", "req-2"), {
        kind: "pending",
      });

      await repository.complete("idem-1", "req-1", "ord_1", response);

      assert.deepEqual(await repository.claimOrGet("idem-1", "req-3"), {
        kind: "completed",
        orderId: "ord_1",
        response,
      });
    },
  );
});

test("stale pending claims can be taken over but fresh ones cannot", async () => {
  await withEnv(
    {
      IDEMPOTENCY_PROCESSING_LEASE_MS: 20,
      IDEMPOTENCY_WAIT_TIMEOUT_MS: 25,
      IDEMPOTENCY_WAIT_POLL_MS: 5,
    },
    async () => {
      const db = new InMemoryDb();
      const repository = new IdempotencyRepository(db as never, silentLogger);

      await repository.claimOrGet("idem-fresh", "req-1");
      assert.equal(
        await repository.takeOverIfStale("idem-fresh", "req-2"),
        false,
      );

      await repository.claimOrGet("idem-stale", "req-3");
      await delay(30);

      assert.deepEqual(await repository.claimOrGet("idem-stale", "req-4"), {
        kind: "stale_pending",
      });
      assert.equal(
        await repository.takeOverIfStale("idem-stale", "req-4"),
        true,
      );
    },
  );
});

test("concurrent duplicates create one order and replay the winner response", async () => {
  await withEnv(
    {
      IDEMPOTENCY_PROCESSING_LEASE_MS: 250,
      IDEMPOTENCY_WAIT_TIMEOUT_MS: 150,
      IDEMPOTENCY_WAIT_POLL_MS: 5,
    },
    async () => {
      const { db, getInsertCalls, dependencies } = buildOrdersHarness({
        insertDelayMs: 40,
      });
      const event = createOrderEvent("idem-race");

      const first = handleCreateOrderResult(event, "req-1", dependencies);
      await delay(5);
      const second = handleCreateOrderResult(event, "req-2", dependencies);

      const [resultA, resultB] = await Promise.all([first, second]);
      const statuses = [resultA.statusCode, resultB.statusCode].sort();
      const bodyA = parseBody<{ orderId: string }>(resultA);
      const bodyB = parseBody<{ orderId: string }>(resultB);

      assert.deepEqual(statuses, [200, 201]);
      assert.equal(bodyA.orderId, bodyB.orderId);
      assert.equal(getInsertCalls(), 1);
      assert.equal(db.collection("orders").count(), 1);
    },
  );
});

test("failed order creation releases the pending claim so a retry can succeed", async () => {
  await withEnv(
    {
      IDEMPOTENCY_PROCESSING_LEASE_MS: 250,
      IDEMPOTENCY_WAIT_TIMEOUT_MS: 50,
      IDEMPOTENCY_WAIT_POLL_MS: 5,
    },
    async () => {
      const harness = buildOrdersHarness({ failFirstInsert: true });
      const event = createOrderEvent("idem-retry-after-failure");

      await assert.rejects(
        () => handleCreateOrder(event, "req-1", harness.dependencies),
        /insert failed/,
      );

      const retry = await handleCreateOrderResult(
        event,
        "req-2",
        harness.dependencies,
      );

      assert.equal(retry.statusCode, 201);
      assert.equal(harness.getInsertCalls(), 2);
      assert.equal(harness.db.collection("orders").count(), 1);
    },
  );
});

test("publish failure after commit replays the committed order on retry", async () => {
  await withEnv(
    {
      IDEMPOTENCY_PROCESSING_LEASE_MS: 250,
      IDEMPOTENCY_WAIT_TIMEOUT_MS: 50,
      IDEMPOTENCY_WAIT_POLL_MS: 5,
    },
    async () => {
      const harness = buildOrdersHarness({ failFirstPublish: true });
      const event = createOrderEvent("idem-publish-failure");

      await assert.rejects(
        () => handleCreateOrder(event, "req-1", harness.dependencies),
        /publish failed/,
      );

      const retry = await handleCreateOrderResult(
        event,
        "req-2",
        harness.dependencies,
      );
      const body = parseBody<{ orderId: string }>(retry);

      assert.equal(retry.statusCode, 200);
      assert.equal(body.orderId, "ord_test_1");
      assert.equal(harness.getInsertCalls(), 1);
      assert.equal(harness.getPublishCalls(), 1);
    },
  );
});

test("order documents store only provider authorization references", async () => {
  const harness = buildOrdersHarness();
  const event = createOrderEvent("idem-no-token-storage");

  const result = await handleCreateOrderResult(
    event,
    "req-1",
    harness.dependencies,
  );

  assert.equal(result.statusCode, 201);

  const storedOrder = await harness.ordersRepository.findById("ord_test_1");
  assert.equal(
    storedOrder.paymentAuthorizationRef,
    "auth_mock_idem_no_token_storage_authorize",
  );
  assert.equal("paymentToken" in storedOrder, false);
  assert.equal("paymentTokenExpiresAt" in storedOrder, false);
});

test("in-flight duplicate returns conflict when the wait budget expires", async () => {
  await withEnv(
    {
      IDEMPOTENCY_PROCESSING_LEASE_MS: 250,
      IDEMPOTENCY_WAIT_TIMEOUT_MS: 20,
      IDEMPOTENCY_WAIT_POLL_MS: 5,
    },
    async () => {
      const harness = buildOrdersHarness({ insertDelayMs: 60 });
      const event = createOrderEvent("idem-timeout");

      const first = handleCreateOrderResult(
        event,
        "req-1",
        harness.dependencies,
      );
      await delay(5);

      await assert.rejects(
        () => handleCreateOrder(event, "req-2", harness.dependencies),
        (error: unknown) =>
          Boolean(
            error &&
              typeof error === "object" &&
              "code" in error &&
              "httpStatus" in error &&
              "message" in error &&
              (error as { code: string }).code === "CONFLICT" &&
              (error as { httpStatus: number }).httpStatus === 409 &&
              /already being processed/.test(
                (error as { message: string }).message,
              ),
          ),
      );

      const winner = await first;

      assert.equal(winner.statusCode, 201);
      assert.equal(harness.getInsertCalls(), 1);
    },
  );
});
