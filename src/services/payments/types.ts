export type PaymentStatus = "pending" | "succeeded" | "failed";
export type PaymentProvider = "stripe" | "paypal";

// ---------------------------------------------------------------------------
// Domain: Payment document (as stored in MongoDB)
// ---------------------------------------------------------------------------

export interface PaymentDocument {
  _id: string; // pay_xxx
  orderId: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  amountCents: number;
  authorizationRef: string;
  transactionRef: string | null;
  idempotencyKey: string;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// EventBridge event shapes
// ---------------------------------------------------------------------------

// Consumed: emitted by Order Service
export interface OrderCreatedEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: {
    orderId: string;
    paymentAuthorization: {
      provider: PaymentProvider;
      authorizationRef: string;
    };
  };
}

// Consumed: emitted by Invoice Service
export interface InvoiceGeneratedEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: {
    orderId: string;
    invoiceId: string;
    invoiceNumber: string;
    grandTotalCents: number;
  };
}

// Produced: consumed by Shipment Service, Order Service, Notification Service
export interface PaymentSucceededEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: { orderId: string; paymentId: string; transactionRef: string };
}

export interface PaymentFailedEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: { orderId: string; paymentId: string; reason: string };
}
