// ---------------------------------------------------------------------------
// Shared sub-types
// ---------------------------------------------------------------------------

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface OrderItem {
  productId: string;
  variantId?: string;
  quantity: number;
}

export type ShippingMethod = "standard" | "express" | "overnight";
export type PaymentProvider = "stripe" | "paypal";
export type OrderStatus = "pending" | "confirmed" | "processing" | "shipped" | "delivered" | "cancelled" | "failed";

export interface StatusHistoryEntry {
  status: OrderStatus;
  timestamp: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// Domain: Order document (as stored in MongoDB)
// ---------------------------------------------------------------------------

export interface OrderDocument {
  _id: string; // ord_xxx
  status: OrderStatus;
  customer: {
    name: string;
    email: string;
    shippingAddress: Address;
    billingAddress: Address;
  };
  items: OrderItem[];
  shippingMethod: ShippingMethod;
  paymentProvider: PaymentProvider;
  paymentToken: string;
  grandTotalCents: number | null;
  invoiceId: string | null;
  statusHistory: StatusHistoryEntry[];
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  paymentTokenExpiresAt: string; // ISO-8601 (createdAt + 30 min)
}

// ---------------------------------------------------------------------------
// Domain: Idempotency record (as stored in MongoDB)
// ---------------------------------------------------------------------------

export interface IdempotencyDocument {
  _id: string; // the idempotency key itself
  orderId: string;
  response: CreateOrderResponse;
  createdAt: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// API request/response shapes
// ---------------------------------------------------------------------------

export interface CreateOrderRequest {
  idempotencyKey?: string; // may come from header instead
  customer: {
    name: string;
    email: string;
    shippingAddress: Address;
    billingAddress: Address;
  };
  items: OrderItem[];
  shippingMethod: ShippingMethod;
  payment: {
    provider: PaymentProvider;
    token: string;
  };
}

export interface CreateOrderResponse {
  orderId: string;
  status: OrderStatus;
  items: OrderItem[];
  shippingMethod: ShippingMethod;
  customer: { email: string };
  createdAt: string;
}

export interface GetOrderResponse {
  orderId: string;
  status: OrderStatus;
  customer: {
    name: string;
    email: string;
    shippingAddress: Address;
  };
  items: OrderItem[];
  shippingMethod: ShippingMethod;
  shippingCostCents: number | null;
  grandTotalCents: number | null;
  invoiceId: string | null;
  payment: { status: string; provider: PaymentProvider };
  shipments: unknown[];
  statusHistory: StatusHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// EventBridge event shapes
// ---------------------------------------------------------------------------

export interface OrderCreatedEventDetail {
  metadata: {
    eventId: string;
    timestamp: string;
    correlationId: string; // orderId
    version: string;
  };
  data: {
    orderId: string;
    items: OrderItem[];
    customer: {
      name: string;
      email: string;
      shippingAddress: Address;
    };
    shippingMethod: ShippingMethod;
    paymentDetails: {
      provider: PaymentProvider;
      token: string;
    };
  };
}
