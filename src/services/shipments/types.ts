export type ShipmentStatus = "created" | "in_transit" | "delivered" | "held";
export type ShippingProvider = "dhl" | "fedex";

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface ShipmentItem {
  productId: string;
  variantId?: string;
  quantity: number;
}

// ---------------------------------------------------------------------------
// Domain: Shipment document (as stored in MongoDB)
// ---------------------------------------------------------------------------

export interface ShipmentDocument {
  _id: string; // shp_xxx
  orderId: string;
  groupIndex: number;
  items: ShipmentItem[];
  shippingAddress: Address;
  provider: ShippingProvider;
  trackingNumber: string | null;
  status: ShipmentStatus;
  retryCount: number;
  circuitState: "closed" | "open" | "half-open";
  shippedAt: string | null;
  deliveredAt: string | null;
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
    items: ShipmentItem[];
    customer: { shippingAddress: Address };
  };
}

// Consumed: emitted by Payment Service
export interface PaymentSucceededEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: {
    orderId: string;
    paymentId: string;
    transactionRef: string;
  };
}

// Domain: local projection of the order, stored when order.created is consumed
export interface OrderProjectionDocument {
  _id: string; // orderId
  items: ShipmentItem[];
  shippingAddress: Address;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// EventBridge event shapes
// ---------------------------------------------------------------------------

// Produced: consumed by Order Service, Notification Service
export interface ShipmentCreatedEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: {
    orderId: string;
    shipmentId: string;
    trackingNumber: string;
    provider: ShippingProvider;
    items: ShipmentItem[];
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
    items: ShipmentItem[];
    reason: string;
    retriesExhausted: boolean;
  };
}
