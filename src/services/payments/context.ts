import { getDb } from "../../shared/db";
import {
  getEventBridgeClient,
  DEFAULT_BUS_NAME,
} from "../../shared/eventbridge";
import { Logger } from "../../shared/logger";
import { PaymentRepository } from "./repositories/payment.repository";
import { PaymentEvents } from "./events/payment.events";
import { IPaymentProvider } from "./providers/payment-provider.interface";
import { MockStripeProvider } from "./providers/stripe/mock-stripe.provider";

export interface PaymentsContext {
  paymentRepository: PaymentRepository;
  paymentEvents: PaymentEvents;
  paymentProvider: IPaymentProvider;
}

export async function init(logger: Logger): Promise<PaymentsContext> {
  const db = await getDb();

  return {
    paymentRepository: new PaymentRepository(db, logger),
    paymentEvents: new PaymentEvents(
      process.env.EVENTBRIDGE_BUS_NAME ?? DEFAULT_BUS_NAME,
      getEventBridgeClient(),
      logger,
    ),
    // replace with provider based on feature flag or environment
    paymentProvider: new MockStripeProvider(),
  };
}
