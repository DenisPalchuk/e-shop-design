export interface ChargeResult {
  transactionRef: string;
}

export interface AuthorizationResult {
  authorizationRef: string;
}

export interface IPaymentProvider {
  authorize(params: {
    token: string;
    idempotencyKey: string;
  }): Promise<AuthorizationResult>;

  capture(params: {
    amountCents: number;
    authorizationRef: string;
    idempotencyKey: string;
  }): Promise<ChargeResult>;
}
