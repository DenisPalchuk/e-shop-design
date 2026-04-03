export interface ChargeResult {
  transactionRef: string;
}

export interface IPaymentProvider {
  charge(params: {
    amountCents: number;
    token: string;
    idempotencyKey: string;
  }): Promise<ChargeResult>;
}
