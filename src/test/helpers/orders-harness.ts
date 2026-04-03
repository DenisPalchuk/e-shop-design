import { ClientSession } from "mongodb";
import { handleCreateOrder } from "../../services/orders/handler";
import { IdempotencyRepository } from "../../services/orders/repositories/idempotency.repository";
import { OrderRepository } from "../../services/orders/repositories/order.repository";
import { Logger } from "../../shared/logger";
import { InMemoryDb } from "./in-memory-db";

type CreateOrderDependencies = NonNullable<Parameters<typeof handleCreateOrder>[2]>;
type OrdersContext = Awaited<
  ReturnType<NonNullable<CreateOrderDependencies["initOrders"]>>
>;

export interface OrdersHarnessOptions {
  insertDelayMs?: number;
  failFirstInsert?: boolean;
  failFirstPublish?: boolean;
}

export const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return this;
  },
} as unknown as Logger;

export function buildOrdersHarness(options: OrdersHarnessOptions = {}) {
  const db = new InMemoryDb();
  const idempotencyRepository = new IdempotencyRepository(db as never, silentLogger);
  const ordersRepository = new OrderRepository(db as never, silentLogger);
  const realInsert = ordersRepository.insert.bind(ordersRepository);
  let insertCalls = 0;

  ordersRepository.insert = async (order, session) => {
    insertCalls += 1;

    if (options.insertDelayMs && insertCalls === 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, options.insertDelayMs);
      });
    }

    if (options.failFirstInsert && insertCalls === 1) {
      throw new Error("insert failed");
    }

    return realInsert(order, session);
  };

  let publishCalls = 0;

  const ordersEvents = {
    async publishOrderCreated(order: unknown) {
      publishCalls += 1;

      if (options.failFirstPublish && publishCalls === 1) {
        throw new Error("publish failed");
      }

      return order;
    },
  };

  const paymentProvider = {
    async authorize({ idempotencyKey }: { idempotencyKey: string }) {
      return {
        authorizationRef: `auth_mock_${idempotencyKey.replace(/[^a-zA-Z0-9]+/g, "_")}`,
      };
    },
  };

  let orderIdCounter = 0;
  const dependencies = {
    initOrders: async () =>
      ({
        ordersRepository,
        idempotencyRepository,
        ordersEvents,
        paymentProvider,
      }) as OrdersContext,
    transactionRunner: async <T>(
      work: (session: ClientSession) => Promise<T>,
    ): Promise<T> => work({} as ClientSession),
    orderIdFactory: () => `ord_test_${++orderIdCounter}`,
    loggerFactory: () => silentLogger,
  } satisfies CreateOrderDependencies;

  return {
    db,
    idempotencyRepository,
    ordersRepository,
    getInsertCalls: () => insertCalls,
    getPublishCalls: () => publishCalls,
    dependencies,
  };
}
