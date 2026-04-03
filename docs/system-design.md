# E-Commerce Checkout System — System Design

**Version:** 1.0
**Date:** 2026-03-29
**Based on:** Requirements Specification v1.1

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Microservice Boundaries](#2-microservice-boundaries)
3. [Event-Driven Architecture](#3-event-driven-architecture)
4. [REST API Specification](#4-rest-api-specification)
5. [Data Models](#5-data-models)
6. [Provider Abstractions](#6-provider-abstractions)
7. [Error Handling & Resilience](#7-error-handling--resilience)
8. [AWS Infrastructure Mapping](#8-aws-infrastructure-mapping)
9. [Sequence Diagrams](#9-sequence-diagrams)

---

## 1. High-Level Architecture

```
                                 ┌─────────────────────────────┐
                                 │       AWS API Gateway       │
                                 │   (Rate Limiting, API Key)  │
                                 └─────────────┬───────────────┘
                                               │
                           ┌───────────────────┼───────────────────┐
                           │                   │                   │
                 ┌─────────▼────────┐ ┌───────▼────────┐ ┌───────▼────────┐
                 │  Order Service   │ │ Invoice Service│ │  Admin Service │
                 │   (Lambda)       │ │   (Lambda)     │ │   (Lambda)     │
                 └─────────┬────────┘ └───────┬────────┘ └───────┬────────┘
                           │                   │                   │
                           ▼                   ▼                   ▼
                 ┌──────────────────────────────────────────────────────────┐
                 │                   Amazon EventBridge                     │
                 │              (Central Event Bus)                         │
                 └──┬──────────┬──────────┬──────────┬──────────┬──────────┘
                    │          │          │          │          │
                    ▼          ▼          ▼          ▼          ▼
               ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
               │  SQS   │ │  SQS   │ │  SQS   │ │  SQS   │ │  SQS   │
               │inventory│ │pricing │ │payment │ │shipment│ │notific.│
               │ queue   │ │ queue  │ │ queue  │ │ queue  │ │ queue  │
               └───┬─────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘
                   │  ┌DLQ┐    │  ┌DLQ┐   │  ┌DLQ┐   │  ┌DLQ┐   │  ┌DLQ┐
                   │  └───┘    │  └───┘   │  └───┘   │  └───┘   │  └───┘
                   ▼           ▼          ▼          ▼          ▼
           ┌───────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────────┐
           │ Inventory │ │Pricing │ │Payment │ │Shipment│ │Notification│
           │ Service   │ │Service │ │Service │ │Service │ │ Service    │
           │ (Lambda)  │ │(Lambda)│ │(Lambda)│ │(Lambda)│ │ (Lambda)   │
           └─────┬─────┘ └───┬────┘ └───┬────┘ └───┬────┘ └─────┬──────┘
                 │           │          │          │            │
                 ▼           ▼          ▼          ▼            ▼
           ┌─────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐
           │ MongoDB │ │MongoDB │ │Stripe/ │ │FedEx/  │ │ AWS SES  │
           │ Atlas   │ │ Atlas  │ │PayPal  │ │DHL     │ │          │
           │(Catalog)│ │        │ │        │ │        │ │          │
           └─────────┘ └────────┘ └────────┘ └────────┘ └──────────┘
```

**Design Principles:**
- Each microservice owns its data and communicates exclusively via events
- EventBridge is the central nervous system — all state transitions flow through it
- SQS queues sit between EventBridge and each Lambda consumer for buffering, retry, and DLQ
- Each SQS queue has a paired Dead Letter Queue (DLQ) for failed messages
- Lambda functions are stateless; all state lives in MongoDB Atlas

---

## 2. Microservice Boundaries

### 2.1 Order Service
**Responsibility:** Order lifecycle management, status tracking, idempotency/debounce
**Data Store:** MongoDB Atlas `orders` table
**Owns:**
- Order creation and validation
- Order status state machine
- Idempotency key tracking (debounce)

### 2.2 Inventory Service
**Responsibility:** Stock validation and reservation
**Data Store:** Queries external inventory system (not owned)
**Owns:**
- Inventory check orchestration
- Stock reservation during checkout flow

### 2.3 Pricing Service
**Responsibility:** Price calculation
**Data Store:** Queries product catalog for unit prices (not owned), caches in MongoDB Atlas
**Owns:**
- Line item total calculation
- Shipping cost calculation
- Grand total computation

### 2.4 Invoice Service
**Responsibility:** Invoice generation, storage, and retrieval
**Data Store:** MongoDB Atlas `invoices` table + S3 for PDF storage
**Owns:**
- Invoice number generation (atomic counter)
- Invoice document creation
- Invoice retrieval API

### 2.5 Payment Service
**Responsibility:** Payment processing via provider abstraction
**Data Store:** MongoDB Atlas `payments` table (status tracking only — NO card data)
**Owns:**
- Payment provider abstraction (strategy pattern)
- Idempotent charge execution
- Payment status tracking

### 2.6 Shipment Service
**Responsibility:** Shipment orchestration, split logic, provider abstraction
**Data Store:** MongoDB Atlas `shipments` table
**Owns:**
- Warehouse-based split shipping logic
- Shipping provider abstraction (strategy pattern)
- Tracking number storage
- Circuit breaker state
- Delivery webhook consumption

### 2.7 Notification Service
**Responsibility:** Customer and support notifications
**Data Store:** MongoDB Atlas `notifications` table (delivery tracking)
**Owns:**
- Channel abstraction (email now, SMS/push later)
- Notification template rendering
- Delivery status tracking

### 2.8 Admin Service
**Responsibility:** Support staff operations
**Data Store:** None (operates on other services' data via events)
**Owns:**
- Retry/cancel held shipments
- Authorization enforcement for admin operations

---

## 3. Event-Driven Architecture

### 3.1 Event Bus: Amazon EventBridge

All domain events flow through a single custom EventBridge bus: `checkout-events`.

### 3.2 Event Catalog

| Event Name | Source | Payload Key Fields | Consumers |
|---|---|---|---|
| `order.created` | Order Service | orderId, items[], customer, shippingMethod, paymentDetails | Inventory Service, Notification Service |
| `inventory.confirmed` | Inventory Service | orderId, reservationId | Pricing Service, Order Service |
| `inventory.failed` | Inventory Service | orderId, unavailableItems[] | Order Service, Notification Service |
| `order.priced` | Pricing Service | orderId, lineItems[], shippingCost, grandTotal | Invoice Service, Order Service |
| `invoice.generated` | Invoice Service | orderId, invoiceId, invoiceNumber | Payment Service, Order Service |
| `payment.succeeded` | Payment Service | orderId, paymentId, transactionRef | Shipment Service, Order Service, Notification Service |
| `payment.failed` | Payment Service | orderId, paymentId, reason | Order Service, Notification Service |
| `shipment.created` | Shipment Service | orderId, shipmentId, trackingNumber, items[] | Order Service, Notification Service |
| `shipment.all_shipped` | Shipment Service | orderId, shipments[] | Order Service, Notification Service |
| `shipment.held` | Shipment Service | orderId, shipmentId, reason, retriesExhausted | Order Service, Notification Service (support) |
| `shipment.delivered` | Shipment Service | orderId, shipmentId, trackingNumber | Order Service, Notification Service |
| `shipment.retry_requested` | Admin Service | orderId, shipmentId, adminUserId | Shipment Service |
| `shipment.cancelled` | Admin Service | orderId, shipmentId, adminUserId, reason | Shipment Service, Order Service, Notification Service |

### 3.3 Event Schema (EventBridge Format)

```json
{
  "source": "checkout.order-service",
  "detail-type": "order.created",
  "detail": {
    "metadata": {
      "eventId": "evt_abc123",
      "timestamp": "2026-03-29T10:00:00Z",
      "correlationId": "ord_xyz789",
      "version": "1.0"
    },
    "data": {
      // event-specific payload
    }
  }
}
```

### 3.4 Event Flow per Consumer (SQS Buffering)

```
EventBridge Rule  ──►  SQS Queue  ──►  Lambda Consumer
                           │
                           ├──► Redrive Policy (maxReceiveCount: 3)
                           │
                           └──► DLQ (SQS Dead Letter Queue)
```

Each consumer has its own SQS queue with:
- **Visibility timeout:** 30 seconds (tunable per service)
- **Max receive count:** 3 (before moving to DLQ)
- **DLQ retention:** 14 days
- **CloudWatch alarm** on DLQ message count > 0

---

## 4. REST API Specification

### 4.1 Base URL

```
https://api.example.com/v1
```

### 4.2 Common Headers

| Header | Required | Description |
|---|---|---|
| `Content-Type` | Yes | `application/json` |
| `X-Idempotency-Key` | Yes (POST) | Client-provided idempotency key for debounce |
| `X-Api-Key` | Yes | API key for rate limiting (API Gateway) |

### 4.3 Common Error Response

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": [
      { "field": "items[0].quantity", "issue": "Must be a positive integer" }
    ],
    "requestId": "req_abc123"
  }
}
```

Error codes: `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `IDEMPOTENCY_CONFLICT`, `INTERNAL_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`

---

### 4.4 POST /v1/orders — Create Order

**Description:** Submit a shopping cart to create a new order. This is the main entry point.

**Request:**

```json
{
  "idempotencyKey": "idk_client_generated_uuid",
  "customer": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "shippingAddress": {
      "line1": "123 Main St",
      "line2": "Apt 4B",
      "city": "New York",
      "state": "NY",
      "postalCode": "10001",
      "country": "US"
    },
    "billingAddress": {
      "line1": "123 Main St",
      "line2": "Apt 4B",
      "city": "New York",
      "state": "NY",
      "postalCode": "10001",
      "country": "US"
    }
  },
  "items": [
    {
      "productId": "prod_abc123",
      "variantId": "var_red_xl",
      "quantity": 2
    },
    {
      "productId": "prod_def456",
      "quantity": 1
    }
  ],
  "shippingMethod": "standard",
  "payment": {
    "provider": "stripe",
    "token": "tok_visa_4242"
  }
}
```

**Response — 201 Created:**

```json
{
  "orderId": "ord_xyz789",
  "status": "pending",
  "items": [
    {
      "productId": "prod_abc123",
      "variantId": "var_red_xl",
      "quantity": 2
    },
    {
      "productId": "prod_def456",
      "variantId": null,
      "quantity": 1
    }
  ],
  "shippingMethod": "standard",
  "customer": {
    "email": "jane@example.com"
  },
  "createdAt": "2026-03-29T10:00:00Z"
}
```

**Response — 200 OK (Idempotent duplicate):**
Returns the same response as the original 201, indicating debounce caught a duplicate.

**Response — 400 Bad Request:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid order request",
    "details": [
      { "field": "items[0].quantity", "issue": "Must be a positive integer" },
      { "field": "payment.token", "issue": "Required" }
    ]
  }
}
```

**Idempotency behavior:**
- If `X-Idempotency-Key` matches a request processed within the debounce window (e.g., 5 minutes), return the cached response with `200 OK`.
- The debounce window is configurable via environment variable.

---

### 4.5 GET /v1/orders/{orderId} — Get Order Status

**Response — 200 OK:**

```json
{
  "orderId": "ord_xyz789",
  "status": "shipped",
  "customer": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "shippingAddress": { "..." : "..." }
  },
  "items": [
    {
      "productId": "prod_abc123",
      "variantId": "var_red_xl",
      "quantity": 2,
      "unitPriceCents": 2999,
      "totalCents": 5998
    },
    {
      "productId": "prod_def456",
      "variantId": null,
      "quantity": 1,
      "unitPriceCents": 4999,
      "totalCents": 4999
    }
  ],
  "shippingMethod": "standard",
  "shippingCostCents": 599,
  "grandTotalCents": 11596,
  "invoiceId": "inv_abc123",
  "payment": {
    "status": "succeeded",
    "provider": "stripe",
    "transactionRef": "ch_stripe_ref"
  },
  "shipments": [
    {
      "shipmentId": "shp_001",
      "status": "delivered",
      "trackingNumber": "FX123456789",
      "provider": "fedex",
      "items": ["prod_abc123"],
      "shippedAt": "2026-03-30T14:00:00Z",
      "deliveredAt": "2026-04-01T09:00:00Z"
    },
    {
      "shipmentId": "shp_002",
      "status": "in_transit",
      "trackingNumber": "DHL987654321",
      "provider": "dhl",
      "items": ["prod_def456"],
      "shippedAt": "2026-03-31T10:00:00Z",
      "deliveredAt": null
    }
  ],
  "statusHistory": [
    { "status": "pending", "timestamp": "2026-03-29T10:00:00Z" },
    { "status": "inventory_confirmed", "timestamp": "2026-03-29T10:00:02Z" },
    { "status": "priced", "timestamp": "2026-03-29T10:00:03Z" },
    { "status": "invoiced", "timestamp": "2026-03-29T10:00:04Z" },
    { "status": "payment_confirmed", "timestamp": "2026-03-29T10:00:06Z" },
    { "status": "partially_shipped", "timestamp": "2026-03-30T14:00:00Z" },
    { "status": "shipped", "timestamp": "2026-03-31T10:00:00Z" }
  ],
  "createdAt": "2026-03-29T10:00:00Z",
  "updatedAt": "2026-03-31T10:00:00Z"
}
```

---

### 4.6 GET /v1/orders/{orderId}/invoice — Get Invoice

**Response — 200 OK:**

```json
{
  "invoiceId": "inv_abc123",
  "invoiceNumber": "INV-2026-000042",
  "orderId": "ord_xyz789",
  "customer": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "billingAddress": { "..." : "..." }
  },
  "lineItems": [
    {
      "productId": "prod_abc123",
      "description": "Red XL T-Shirt",
      "quantity": 2,
      "unitPriceCents": 2999,
      "totalCents": 5998
    },
    {
      "productId": "prod_def456",
      "description": "Blue Jeans",
      "quantity": 1,
      "unitPriceCents": 4999,
      "totalCents": 4999
    }
  ],
  "shippingCostCents": 599,
  "grandTotalCents": 11596,
  "currency": "USD",
  "issuedAt": "2026-03-29T10:00:04Z"
}
```

**Response — 404 Not Found:** if invoice is not yet generated (order still in `pending`/`inventory_confirmed`/`priced` status).

---

### 4.7 POST /v1/admin/shipments/{shipmentId}/retry — Retry Held Shipment

**Headers:** Requires `X-Admin-Token` (support staff authorization)

**Response — 202 Accepted:**

```json
{
  "shipmentId": "shp_001",
  "action": "retry",
  "status": "retry_initiated",
  "message": "Shipment retry has been queued"
}
```

---

### 4.8 POST /v1/admin/shipments/{shipmentId}/cancel — Cancel Held Shipment

**Headers:** Requires `X-Admin-Token`

**Request:**
```json
{
  "reason": "Customer requested cancellation after shipping delay"
}
```

**Response — 200 OK:**

```json
{
  "shipmentId": "shp_001",
  "action": "cancel",
  "status": "cancelled",
  "message": "Shipment cancelled. Customer will be notified."
}
```

---

### 4.9 POST /v1/webhooks/shipment-status — Shipping Provider Webhook

**Description:** Receives delivery status updates from shipping providers (FedEx, DHL, etc.)

**Request (from provider):**
```json
{
  "provider": "fedex",
  "trackingNumber": "FX123456789",
  "status": "delivered",
  "timestamp": "2026-04-01T09:00:00Z",
  "signature": "hmac_sha256_signature"
}
```

**Response — 200 OK:**
```json
{ "received": true }
```

---

## 5. Data Models

### 5.1 `orders` Collection

```json
{
  "_id": "ord_xyz789",
  "status": "shipped",
  "customer": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "shippingAddress": {
      "line1": "123 Main St",
      "line2": "Apt 4B",
      "city": "New York",
      "state": "NY",
      "postalCode": "10001",
      "country": "US"
    },
    "billingAddress": { "..." : "..." }
  },
  "items": [
    { "productId": "prod_abc123", "variantId": "var_red_xl", "quantity": 2 },
    { "productId": "prod_def456", "variantId": null, "quantity": 1 }
  ],
  "shippingMethod": "standard",
  "paymentProvider": "stripe",
  "paymentToken": "tok_...",
  "grandTotalCents": 11596,
  "invoiceId": "inv_abc123",
  "statusHistory": [
    { "status": "pending", "timestamp": "2026-03-29T10:00:00Z" },
    { "status": "inventory_confirmed", "timestamp": "2026-03-29T10:00:02Z" }
  ],
  "createdAt": "2026-03-29T10:00:00Z",
  "updatedAt": "2026-03-31T10:00:00Z",
  "paymentTokenExpiresAt": "2026-03-29T10:30:00Z"
}
```

**Indexes:**
- `{ _id: 1 }` — primary key (orderId)
- `{ status: 1, createdAt: -1 }` — admin dashboard queries by status
- `{ "customer.email": 1 }` — lookup orders by customer email

**Idempotency sub-collection: `order_idempotency`**

```json
{
  "_id": "idk_client_generated_uuid",
  "orderId": "ord_xyz789",
  "response": { "..." : "cached 201 response" },
  "createdAt": "2026-03-29T10:00:00Z",
  "expiresAt": "2026-03-29T10:05:00Z"
}
```

**Indexes:**
- `{ expiresAt: 1 }` — TTL index, MongoDB auto-deletes expired records (5 min debounce window)

### 5.2 `invoices` Collection

```json
{
  "_id": "inv_abc123",
  "invoiceNumber": "INV-2026-000042",
  "orderId": "ord_xyz789",
  "customer": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "billingAddress": { "..." : "..." }
  },
  "lineItems": [
    {
      "productId": "prod_abc123",
      "description": "Red XL T-Shirt",
      "quantity": 2,
      "unitPriceCents": 2999,
      "totalCents": 5998
    }
  ],
  "shippingCostCents": 599,
  "grandTotalCents": 11596,
  "currency": "USD",
  "issuedAt": "2026-03-29T10:00:04Z"
}
```

**Indexes:**
- `{ orderId: 1 }` — unique, lookup invoice by order
- `{ invoiceNumber: 1 }` — unique, human-readable lookup

### 5.3 `payments` Collection

```json
{
  "_id": "pay_abc123",
  "orderId": "ord_xyz789",
  "provider": "stripe",
  "status": "succeeded",
  "amountCents": 11596,
  "transactionRef": "ch_stripe_ref",
  "idempotencyKey": "ord_xyz789_pay",
  "failureReason": null,
  "createdAt": "2026-03-29T10:00:05Z",
  "updatedAt": "2026-03-29T10:00:06Z"
}
```

**Indexes:**
- `{ orderId: 1 }` — lookup payment by order
- `{ idempotencyKey: 1 }` — unique, prevent double charges

### 5.4 `shipments` Collection

```json
{
  "_id": "shp_001",
  "orderId": "ord_xyz789",
  "items": [
    { "productId": "prod_abc123", "variantId": "var_red_xl", "quantity": 2 }
  ],
  "warehouseId": "wh_east_01",
  "provider": "fedex",
  "trackingNumber": "FX123456789",
  "status": "delivered",
  "retryCount": 0,
  "lastRetryAt": null,
  "circuitState": "closed",
  "shippedAt": "2026-03-30T14:00:00Z",
  "deliveredAt": "2026-04-01T09:00:00Z",
  "createdAt": "2026-03-29T10:01:00Z",
  "updatedAt": "2026-04-01T09:00:00Z"
}
```

**Indexes:**
- `{ orderId: 1, createdAt: -1 }` — all shipments for an order
- `{ trackingNumber: 1 }` — unique, webhook lookups by tracking number
- `{ status: 1 }` — query held/pending shipments for admin dashboard

### 5.5 `notifications` Collection

```json
{
  "_id": "ntf_abc123",
  "orderId": "ord_xyz789",
  "channel": "email",
  "type": "order_confirmed",
  "recipient": "jane@example.com",
  "status": "sent",
  "sentAt": "2026-03-29T10:00:01Z",
  "createdAt": "2026-03-29T10:00:00Z"
}
```

**Indexes:**
- `{ orderId: 1 }` — all notifications for an order
- `{ status: 1 }` — retry failed notifications

### 5.6 `processed_events` Collection (Deduplication)

```json
{
  "_id": "evt_abc123",
  "processedAt": "2026-03-29T10:00:00Z",
  "expiresAt": "2026-03-30T10:00:00Z"
}
```

**Indexes:**
- `{ expiresAt: 1 }` — TTL index, auto-cleanup after 24 hours

---

## 6. Provider Abstractions

### 6.1 Payment Provider Interface

```typescript
interface PaymentProvider {
  readonly name: string;

  charge(request: ChargeRequest): Promise<ChargeResult>;
}

interface ChargeRequest {
  orderId: string;
  amountCents: number;
  currency: string;
  token: string;              // Provider-specific payment token
  idempotencyKey: string;     // Prevents double charges
  metadata: Record<string, string>;
}

interface ChargeResult {
  success: boolean;
  transactionRef: string | null;  // Provider's reference ID
  failureReason: string | null;
  rawResponse: unknown;           // For logging/debugging
}
```

**Implementations:**

```typescript
class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  async charge(request: ChargeRequest): Promise<ChargeResult> { /* ... */ }
}

class PayPalPaymentProvider implements PaymentProvider {
  readonly name = 'paypal';
  async charge(request: ChargeRequest): Promise<ChargeResult> { /* ... */ }
}
```

**Factory / Registry:**

```typescript
class PaymentProviderRegistry {
  private providers: Map<string, PaymentProvider> = new Map();

  register(provider: PaymentProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): PaymentProvider {
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`Unknown payment provider: ${name}`);
    return provider;
  }
}
```

### 6.2 Shipping Provider Interface

```typescript
interface ShippingProvider {
  readonly name: string;

  createShipment(request: ShipmentRequest): Promise<ShipmentResult>;
  getStatus(trackingNumber: string): Promise<ShipmentStatus>;
}

interface ShipmentRequest {
  shipmentId: string;
  orderId: string;
  items: ShipmentItem[];
  originWarehouseId: string;
  destinationAddress: Address;
  shippingMethod: string;       // "standard", "express"
  idempotencyKey: string;
}

interface ShipmentResult {
  success: boolean;
  trackingNumber: string | null;
  estimatedDelivery: string | null;
  failureReason: string | null;
}

interface ShipmentStatus {
  trackingNumber: string;
  status: 'pending' | 'in_transit' | 'delivered' | 'exception';
  lastUpdate: string;
}
```

**Implementations:**

```typescript
class FedExShippingProvider implements ShippingProvider {
  readonly name = 'fedex';
  async createShipment(req: ShipmentRequest): Promise<ShipmentResult> { /* ... */ }
  async getStatus(trackingNumber: string): Promise<ShipmentStatus> { /* ... */ }
}

class DHLShippingProvider implements ShippingProvider {
  readonly name = 'dhl';
  async createShipment(req: ShipmentRequest): Promise<ShipmentResult> { /* ... */ }
  async getStatus(trackingNumber: string): Promise<ShipmentStatus> { /* ... */ }
}
```

### 6.3 Notification Channel Interface

```typescript
interface NotificationChannel {
  readonly channelType: string;  // "email", "sms", "push"

  send(notification: Notification): Promise<SendResult>;
}

interface Notification {
  notificationId: string;
  orderId: string;
  recipient: string;            // Email address, phone number, etc.
  type: NotificationType;
  templateData: Record<string, unknown>;
}

type NotificationType =
  | 'order_confirmed'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'shipment_shipped'
  | 'shipment_delivered'
  | 'out_of_stock'
  | 'shipment_cancelled';

interface SendResult {
  success: boolean;
  messageId: string | null;
  failureReason: string | null;
}
```

**Implementations:**

```typescript
class EmailChannel implements NotificationChannel {
  readonly channelType = 'email';
  // Uses AWS SES
  async send(notification: Notification): Promise<SendResult> { /* ... */ }
}

// Future:
class SMSChannel implements NotificationChannel {
  readonly channelType = 'sms';
  // Uses AWS SNS
  async send(notification: Notification): Promise<SendResult> { /* ... */ }
}
```

---

## 7. Error Handling & Resilience

### 7.1 Idempotency / Debounce (Order Creation)

```
Client Request (with X-Idempotency-Key)
    │
    ▼
┌───────────────────────────────┐
│ Query order_idempotency       │
│ collection by _id (idem. key) │
└───────────┬───────────────────┘
            │
    ┌───────┴───────┐
    │ Key exists?   │
    ├── YES ────────┼──► Return cached response (200 OK)
    │               │
    └── NO ─────────┼──► Process order, insert with expiresAt
                    │    Return new response (201 Created)
                    ▼
```

- Idempotency records auto-expire via MongoDB TTL index (5 min default, configurable)
- `insertOne` with unique `_id` prevents race conditions (duplicate key error = already processing)

### 7.2 Payment Failure Flow

```
Payment Service receives invoice.generated event
    │
    ▼
Call PaymentProvider.charge() with orderId as idempotency key
    │
    ├── Success ──► Emit payment.succeeded
    │
    └── Failure ──► Emit payment.failed
                        │
                        ▼
                  Order Service sets status = payment_failed
                  Notification Service sends "payment failed" email
                  (Order is held — no automatic retry)
```

### 7.3 Shipping Circuit Breaker

```
                    ┌──────────────────┐
                    │   CLOSED         │  Normal operation
                    │   (calls pass)   │
                    └──────┬───────────┘
                           │ failure count > threshold
                           ▼
                    ┌──────────────────┐
                    │   OPEN           │  All calls blocked
                    │   (fail fast)    │──── After timeout ────┐
                    └──────────────────┘                       │
                           ▲                                   ▼
                           │ failure            ┌──────────────────┐
                           │                    │   HALF-OPEN      │
                           └────────────────────│   (test 1 call)  │
                                                └──────┬───────────┘
                                                       │ success
                                                       ▼
                                                Back to CLOSED
```

**Configuration (environment variables):**

| Parameter | Default | Description |
|---|---|---|
| `CIRCUIT_FAILURE_THRESHOLD` | 5 | Failures before opening |
| `CIRCUIT_RESET_TIMEOUT_MS` | 60000 | Time before half-open |
| `RETRY_MAX_ATTEMPTS` | 5 | Max retries with backoff |
| `RETRY_BASE_DELAY_MS` | 1000 | Base delay for exponential backoff |
| `RETRY_MAX_DELAY_MS` | 30000 | Cap on backoff delay |

**Exponential backoff formula:** `min(baseDelay * 2^attempt + jitter, maxDelay)`

**After retries exhausted:**
1. Shipment status → `held`
2. Order status → `shipment_held`
3. Event `shipment.held` emitted with `retriesExhausted: true`
4. Notification Service sends alert to support staff (via email/Slack webhook)

### 7.4 Event Processing Failures

```
SQS Queue ──► Lambda Consumer
                │
                ├── Success ──► Delete message from queue
                │
                └── Failure ──► Message returns to queue (visibility timeout)
                                    │
                                    ├── Retry 1, 2, 3 (maxReceiveCount)
                                    │
                                    └── Move to DLQ
                                            │
                                            ▼
                                    CloudWatch Alarm fires
                                    Support team investigates
```

### 7.5 Duplicate Event Handling

SQS provides at-least-once delivery, so consumers must handle duplicates. Each consumer follows this order:

1. **Check** `processed_events` for `eventId` — if found, skip (fast-path optimization)
2. **Execute** the idempotent business operation (the actual work)
3. **Insert** `eventId` into `processed_events` with TTL (24 hours) — mark as done

**Why process-then-mark (not mark-then-process):**
- If Lambda crashes after step 2 but before step 3 → `eventId` is not recorded → SQS retries → operation re-executes safely because it is idempotent (conditional MongoDB update is a no-op, Stripe deduplicates by idempotency key)
- If Lambda crashes after step 1 but before step 2 → `eventId` is not recorded → SQS retries → normal processing
- The reverse order (insert first, process second) would **lose events**: if Lambda crashes after insert but before processing, the retry sees the event as "done" and skips it permanently

**`processed_events` is a performance optimization, not a correctness mechanism.** It prevents redundant calls to external APIs (Stripe, FedEx, SES). Correctness is guaranteed by idempotent operations:
- MongoDB: conditional `updateOne({ _id: orderId, status: "invoiced" }, ...)` — only transitions if precondition matches
- Payment: provider-side idempotency key prevents double charges
- Shipment: provider-side idempotency key prevents duplicate shipments

TTL index on `expiresAt` auto-cleans entries after 24 hours.

---

## 8. AWS Infrastructure Mapping

### 8.1 Service → AWS Resource Mapping

| Component | AWS Service | Notes |
|---|---|---|
| API Gateway | API Gateway (REST) | Rate limiting, API key validation, request validation |
| Order Service | Lambda + MongoDB Atlas | Synchronous (API) + async (event consumer) |
| Inventory Service | Lambda | Queries external inventory API |
| Pricing Service | Lambda + MongoDB Atlas | Caches product prices |
| Invoice Service | Lambda + MongoDB Atlas + S3 | S3 for PDF storage |
| Payment Service | Lambda + MongoDB Atlas | Calls Stripe/PayPal APIs |
| Shipment Service | Lambda + MongoDB Atlas | Calls FedEx/DHL APIs, circuit breaker state in MongoDB |
| Notification Service | Lambda + MongoDB Atlas + SES | SES for email delivery |
| Admin Service | Lambda | Triggered via API Gateway |
| Event Bus | EventBridge | Custom bus: `checkout-events` |
| Event Queues | SQS (per consumer) | Buffering + DLQ per queue |
| Monitoring | CloudWatch | Logs, metrics, alarms on DLQ depth |

### 8.2 EventBridge Rules

| Rule Name | Pattern | Target |
|---|---|---|
| `order-created-to-inventory` | `detail-type: order.created` | SQS: `inventory-service-queue` |
| `order-created-to-notification` | `detail-type: order.created` | SQS: `notification-service-queue` |
| `inventory-confirmed-to-pricing` | `detail-type: inventory.confirmed` | SQS: `pricing-service-queue` |
| `inventory-confirmed-to-order` | `detail-type: inventory.confirmed` | SQS: `order-service-queue` |
| `inventory-failed-to-order` | `detail-type: inventory.failed` | SQS: `order-service-queue` |
| `inventory-failed-to-notification` | `detail-type: inventory.failed` | SQS: `notification-service-queue` |
| `order-priced-to-invoice` | `detail-type: order.priced` | SQS: `invoice-service-queue` |
| `invoice-generated-to-payment` | `detail-type: invoice.generated` | SQS: `payment-service-queue` |
| `payment-succeeded-to-shipment` | `detail-type: payment.succeeded` | SQS: `shipment-service-queue` |
| `payment-*-to-order` | `detail-type: payment.*` | SQS: `order-service-queue` |
| `payment-*-to-notification` | `detail-type: payment.*` | SQS: `notification-service-queue` |
| `shipment-*-to-order` | `detail-type: shipment.*` | SQS: `order-service-queue` |
| `shipment-*-to-notification` | `detail-type: shipment.*` | SQS: `notification-service-queue` |
| `admin-retry-to-shipment` | `detail-type: shipment.retry_requested` | SQS: `shipment-service-queue` |
| `admin-cancel-to-shipment` | `detail-type: shipment.cancelled` | SQS: `shipment-service-queue` |

---

## 9. Sequence Diagrams

### 9.1 Happy Path — Complete Order Flow

```
Customer          API GW       Order Svc     Inventory     Pricing      Invoice      Payment      Shipment     Notification
   │                │              │             │            │            │            │            │              │
   │ POST /orders   │              │             │            │            │            │            │              │
   │───────────────►│              │             │            │            │            │            │              │
   │                │─────────────►│             │            │            │            │            │              │
   │                │              │ validate    │            │            │            │            │              │
   │                │              │ check idem. │            │            │            │            │              │
   │                │              │ save order  │            │            │            │            │              │
   │                │◄─────────────│             │            │            │            │            │              │
   │◄───────────────│ 201 Created  │             │            │            │            │            │              │
   │                │              │             │            │            │            │            │              │
   │                │              │──event: order.created──►│            │            │            │              │
   │                │              │             │            │            │            │            │    ┌─────────│
   │                │              │             │            │            │            │            │    │ "order  │
   │                │              │             │            │            │            │            │    │confirmed│
   │                │              │             │            │            │            │            │    │ email"  │
   │                │              │             │check stock │            │            │            │    └─────────│
   │                │              │             │            │            │            │            │              │
   │                │              │◄─event: inventory.confirmed──────────│            │            │              │
   │                │              │ status=     │            │            │            │            │              │
   │                │              │ inventory_  │            │            │            │            │              │
   │                │              │ confirmed   │            │            │            │            │              │
   │                │              │             │            │            │            │            │              │
   │                │              │             │──event: inventory.confirmed────────►│            │              │
   │                │              │             │            │ calc price │            │            │              │
   │                │              │             │            │            │            │            │              │
   │                │              │◄──────event: order.priced│            │            │            │              │
   │                │              │ status=priced            │            │            │            │              │
   │                │              │             │            │──event: order.priced──►│            │              │
   │                │              │             │            │            │ gen invoice│            │              │
   │                │              │             │            │            │            │            │              │
   │                │              │◄─────────event: invoice.generated────│            │            │              │
   │                │              │ status=invoiced          │            │            │            │              │
   │                │              │             │            │            │──event: invoice.generated──►          │
   │                │              │             │            │            │            │ charge     │              │
   │                │              │             │            │            │            │            │              │
   │                │              │◄────────────event: payment.succeeded─│            │              │
   │                │              │ status=payment_confirmed │            │            │    ┌─────────│
   │                │              │             │            │            │            │    │"payment │
   │                │              │             │            │            │            │    │ success"│
   │                │              │             │            │            │            │    │ email   │
   │                │              │             │            │            │            │    └─────────│
   │                │              │             │            │            │──event: payment.succeeded──►         │
   │                │              │             │            │            │            │ split items│              │
   │                │              │             │            │            │            │ create     │              │
   │                │              │             │            │            │            │ shipments  │              │
   │                │              │             │            │            │            │            │              │
   │                │              │◄──────event: shipment.created────────│            │    ┌─────────│
   │                │              │             │            │            │            │    │"shipped"│
   │                │              │ status=     │            │            │            │    │ email + │
   │                │              │ partially_  │            │            │            │    │tracking │
   │                │              │ shipped /   │            │            │            │    └─────────│
   │                │              │ shipped     │            │            │            │              │
```

### 9.2 Payment Failure Flow

```
Payment Svc          Stripe           Order Svc         Notification Svc
    │                   │                 │                    │
    │ charge(token)     │                 │                    │
    │──────────────────►│                 │                    │
    │   card_declined   │                 │                    │
    │◄──────────────────│                 │                    │
    │                   │                 │                    │
    │───event: payment.failed────────────►│                    │
    │                   │                 │ status=            │
    │                   │                 │ payment_failed     │
    │                   │                 │                    │
    │───event: payment.failed─────────────────────────────────►│
    │                   │                 │                    │ send "payment
    │                   │                 │                    │ failed" email
    │                   │                 │                    │
    │            (Order is held. No automatic retry.)          │
```

### 9.3 Shipping Provider Failure + Circuit Breaker

```
Shipment Svc         FedEx API        Order Svc        Notification Svc
    │                   │                │                    │
    │ createShipment()  │                │                    │
    │──────────────────►│                │                    │
    │   503 Unavailable │                │                    │
    │◄──────────────────│                │                    │
    │                   │                │                    │
    │ retry (1s delay)  │                │                    │
    │──────────────────►│                │                    │
    │   503 Unavailable │                │                    │
    │◄──────────────────│                │                    │
    │                   │                │                    │
    │ retry (2s delay)  │                │                    │
    │──────────────────►│                │                    │
    │   503 Unavailable │                │                    │
    │◄──────────────────│                │                    │
    │   ... (up to max) │                │                    │
    │                   │                │                    │
    │ Circuit OPEN      │                │                    │
    │                   │                │                    │
    │───event: shipment.held────────────►│                    │
    │                   │                │ status=            │
    │                   │                │ shipment_held      │
    │                   │                │                    │
    │───event: shipment.held──────────────────────────────────►│
    │                   │                │                    │ alert to
    │                   │                │                    │ support staff
```

### 9.4 Admin Retry Flow

```
Support Staff     API GW      Admin Svc     EventBridge    Shipment Svc    Order Svc
    │                │            │              │              │              │
    │ POST /admin/   │            │              │              │              │
    │ shipments/     │            │              │              │              │
    │ shp_001/retry  │            │              │              │              │
    │───────────────►│───────────►│              │              │              │
    │                │            │──event: shipment.retry_requested──────────►│
    │◄───────────────│◄───────────│ 202 Accepted │              │              │
    │                │            │              │              │ reset circuit│
    │                │            │              │              │ retry call   │
    │                │            │              │              │              │
    │                │            │              │   (success or fail again)   │
```
