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

export interface InvoiceLineItem {
  productId: string;
  variantId?: string;
  description?: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

// ---------------------------------------------------------------------------
// Domain: Invoice document (as stored in MongoDB)
// ---------------------------------------------------------------------------

export interface InvoiceDocument {
  _id: string; // inv_xxx
  invoiceNumber: string; // INV-2026-000042
  orderId: string;
  customer: {
    name: string;
    email: string;
    billingAddress: Address;
  };
  lineItems: InvoiceLineItem[];
  shippingCostCents: number;
  grandTotalCents: number;
  currency: string;
  issuedAt: string; // ISO-8601
}

// Counter document used for atomic invoice number sequencing
export interface CounterDocument {
  _id: string; // e.g. "invoice_2026"
  seq: number;
}

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export interface GetInvoiceResponse {
  invoiceId: string;
  invoiceNumber: string;
  orderId: string;
  customer: {
    name: string;
    email: string;
    billingAddress: Address;
  };
  lineItems: InvoiceLineItem[];
  shippingCostCents: number;
  grandTotalCents: number;
  currency: string;
  issuedAt: string;
}

// ---------------------------------------------------------------------------
// EventBridge event shapes
// ---------------------------------------------------------------------------

// Consumed: emitted by Pricing Service
export interface OrderPricedEventDetail {
  metadata: {
    eventId: string;
    timestamp: string;
    correlationId: string; // orderId
    version: string;
  };
  data: {
    orderId: string;
    lineItems: InvoiceLineItem[];
    shippingCostCents: number;
    grandTotalCents: number;
    customer: {
      name: string;
      email: string;
      billingAddress: Address;
    };
  };
}

// Produced: consumed by Payment Service and Order Service
export interface InvoiceGeneratedEventDetail {
  metadata: {
    eventId: string;
    timestamp: string;
    correlationId: string; // orderId
    version: string;
  };
  data: {
    orderId: string;
    invoiceId: string;
    invoiceNumber: string;
    grandTotalCents: number;
  };
}
