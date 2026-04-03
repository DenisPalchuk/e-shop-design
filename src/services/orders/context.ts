import { getDb } from "../../shared/db";
import { getEventBridgeClient, DEFAULT_BUS_NAME } from "../../shared/eventbridge";
import { Logger } from "../../shared/logger";
import { OrderRepository } from "./repositories/order.repository";
import { IdempotencyRepository } from "./repositories/idempotency.repository";
import { OrderEvents } from "./events/order.events";
import { IPaymentProvider } from "../payments/providers/payment-provider.interface";
import { MockStripeProvider } from "../payments/providers/stripe/mock-stripe.provider";

export interface OrdersContext {
  ordersRepository: OrderRepository;
  idempotencyRepository: IdempotencyRepository;
  ordersEvents: OrderEvents;
  paymentProvider: IPaymentProvider;
}

export async function init(logger: Logger): Promise<OrdersContext> {
  const db = await getDb();

  return {
    ordersRepository: new OrderRepository(db, logger),
    idempotencyRepository: new IdempotencyRepository(db, logger),
    ordersEvents: new OrderEvents(
      process.env.EVENTBRIDGE_BUS_NAME ?? DEFAULT_BUS_NAME,
      getEventBridgeClient(),
      logger,
    ),
    paymentProvider: new MockStripeProvider(),
  };
}
