import {
  AuthorizationResult,
  ChargeResult,
  IPaymentProvider,
} from "../payment-provider.interface";

function toProviderRef(prefix: string, idempotencyKey: string): string {
  return `${prefix}_${idempotencyKey.replace(/[^a-zA-Z0-9]+/g, "_")}`;
}

/**
 * Mock Stripe provider — always succeeds.
 * Replace with real Stripe SDK integration when ready.
 */
export class MockStripeProvider implements IPaymentProvider {
  async authorize(params: {
    token: string;
    idempotencyKey: string;
  }): Promise<AuthorizationResult> {
    void params.token;
    return {
      authorizationRef: toProviderRef("auth_mock", params.idempotencyKey),
    };
  }

  async capture(params: {
    amountCents: number;
    authorizationRef: string;
    idempotencyKey: string;
  }): Promise<ChargeResult> {
    void params.amountCents;
    void params.authorizationRef;
    return {
      transactionRef: toProviderRef("ch_mock", params.idempotencyKey),
    };
  }
}
