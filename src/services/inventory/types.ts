export type InventoryCheckStatus = "confirmed" | "failed";

export interface UnavailableItem {
  productId: string;
  variantId?: string;
  requestedQty: number;
  availableQty: number;
}

// ---------------------------------------------------------------------------
// Domain: Inventory check record (as stored in MongoDB)
// ---------------------------------------------------------------------------

export interface InventoryCheckDocument {
  _id: string; // ivc_xxx
  orderId: string;
  status: InventoryCheckStatus;
  unavailableItems: UnavailableItem[];
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Consumed EventBridge event shapes
// ---------------------------------------------------------------------------

export interface OrderItem {
  productId: string;
  variantId?: string;
  quantity: number;
}

export interface OrderCreatedEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: {
    orderId: string;
    items: OrderItem[];
  };
}

// ---------------------------------------------------------------------------
// Produced EventBridge event shapes
// ---------------------------------------------------------------------------

export interface InventoryConfirmedEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: {
    orderId: string;
    checkId: string;
  };
}

export interface InventoryFailedEventDetail {
  metadata: { eventId: string; timestamp: string; correlationId: string; version: string };
  data: {
    orderId: string;
    checkId: string;
    unavailableItems: UnavailableItem[];
  };
}
