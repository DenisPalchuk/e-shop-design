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
export type ShippingProvider = "dhl" | "fedex";
export type OrderStatus =
  | "pending"
  | "out_of_stock"
  | "inventory_confirmed"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "failed"
  | "shipment_held";
export type ShipmentStatus = "created" | "in_transit" | "delivered" | "held";

export interface ShipmentSummary {
  shipmentId: string;
  status: ShipmentStatus;
  trackingNumber: string | null; // null for held shipments that never got a tracking number
  provider: ShippingProvider;
  items: OrderItem[];
  shippedAt: string | null; // null for held shipments
  deliveredAt: string | null;
}

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
  paymentAuthorizationRef: string;
  grandTotalCents: number | null;
  invoiceId: string | null;
  shipments: ShipmentSummary[];
  statusHistory: StatusHistoryEntry[];
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// Domain: Idempotency record (as stored in MongoDB)
// ---------------------------------------------------------------------------

export type IdempotencyStatus = "pending" | "completed";

interface BaseIdempotencyDocument {
  _id: string; // the idempotency key itself
  status: IdempotencyStatus;
  requestId: string;
  createdAt: string;
  leaseExpiresAt: string;
  expiresAt: string;
}

export interface PendingIdempotencyDocument extends BaseIdempotencyDocument {
  status: "pending";
}

export interface CompletedIdempotencyDocument extends BaseIdempotencyDocument {
  status: "completed";
  orderId: string;
  response: CreateOrderResponse;
}

export type IdempotencyDocument =
  | PendingIdempotencyDocument
  | CompletedIdempotencyDocument;

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
  shipments: ShipmentSummary[];
  statusHistory: StatusHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// EventBridge event shapes
// ---------------------------------------------------------------------------

// Consumed: emitted by Shipment Service
export interface ShipmentCreatedEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: {
    orderId: string;
    shipmentId: string;
    trackingNumber: string;
    provider: ShippingProvider;
    items: OrderItem[];
    shippedAt: string;
  };
}

export interface ShipmentDeliveredEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: {
    orderId: string;
    shipmentId: string;
    trackingNumber: string;
    deliveredAt: string;
  };
}

export interface ShipmentHeldEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: {
    orderId: string;
    shipmentId: string;
    items: OrderItem[];
    reason: string;
    retriesExhausted: boolean;
  };
}

// Consumed: emitted by Inventory Service
export interface InventoryConfirmedEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: {
    orderId: string;
    checkId: string;
  };
}

export interface UnavailableItem {
  productId: string;
  variantId?: string;
  requestedQty: number;
  availableQty: number;
}

export interface InventoryFailedEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: {
    orderId: string;
    checkId: string;
    unavailableItems: UnavailableItem[];
  };
}

// Produced
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
    paymentAuthorization: {
      provider: PaymentProvider;
      authorizationRef: string;
    };
  };
}
