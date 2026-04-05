export type NotificationStatus = "sent" | "failed";
export type NotificationChannel = "email";

// ---------------------------------------------------------------------------
// Domain: Notification document (as stored in MongoDB)
// ---------------------------------------------------------------------------

export interface NotificationDocument {
  _id: string; // ntf_xxx
  orderId: string;
  idempotencyKey: string; // unique per logical notification, e.g. ord_xxx_order_confirmed
  channel: NotificationChannel;
  recipient: string; // email address
  subject: string;
  status: NotificationStatus;
  failureReason: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Domain: Customer projection (local read-model built from order.created)
// ---------------------------------------------------------------------------

export interface CustomerProjectionDocument {
  _id: string; // orderId
  name: string;
  email: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Consumed EventBridge event shapes
// ---------------------------------------------------------------------------

export interface OrderCreatedEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: {
    orderId: string;
    customer: {
      name: string;
      email: string;
    };
  };
}

export interface PaymentSucceededEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: {
    orderId: string;
    paymentId: string;
    transactionRef: string;
  };
}

export interface PaymentFailedEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: {
    orderId: string;
    paymentId: string;
    reason: string;
  };
}

export interface ShipmentCreatedEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: {
    orderId: string;
    shipmentId: string;
    trackingNumber: string;
    provider: string;
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

export interface ShipmentHeldEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: {
    orderId: string;
    shipmentId: string;
    reason: string;
    retriesExhausted: boolean;
  };
}
