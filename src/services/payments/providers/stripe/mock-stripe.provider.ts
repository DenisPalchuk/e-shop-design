import { ChargeResult, IPaymentProvider } from "../payment-provider.interface";
import { generateEventId } from "../../../../shared/ids";

/**
 * Mock Stripe provider — always succeeds.
 * Replace with real Stripe SDK integration when ready.
 */
export class MockStripeProvider implements IPaymentProvider {
  async charge(_params: {
    amountCents: number;
    token: string;
    idempotencyKey: string;
  }): Promise<ChargeResult> {
    // Simulate a Stripe charge_id format
    return { transactionRef: `ch_mock_${generateEventId()}` };
  }
}
