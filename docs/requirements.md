# E-Commerce Checkout System — Requirements Specification

**Version:** 1.1
**Date:** 2026-03-29
**Status:** Draft — Pending Review

---

## 1. Project Overview

Design a backend checkout system for a classic e-commerce store using microservices and event-driven architecture with AWS primitives. The system handles the flow from cart submission through delivery notification.

**In Scope:** Checkout flow only (cart → inventory check → pricing → invoice → payment → shipment → notifications)
**Out of Scope:** Product catalog, user authentication, frontend, tax calculation, discounts/coupons, refunds/chargebacks, multi-currency

---

## 2. Functional Requirements

### FR-1: Order Creation (Cart Submission)

- **FR-1.1:** The system SHALL accept a REST API request containing cart items (product ID, quantity, variant) and customer information (name, email, shipping address, billing address). This is a **guest checkout** model — no customer account is required. Customer details are embedded in the order.
- **FR-1.2:** The system SHALL accept customer-selected shipping method/speed as part of the order creation request.
- **FR-1.3:** The system SHALL accept payment details (card token, payment method type, provider preference) at checkout time — customers do NOT have pre-stored payment methods.
- **FR-1.4:** The system SHALL validate all cart items exist and quantities are positive integers.
- **FR-1.5:** The system SHALL support split shipping — a single order MAY result in multiple shipments.
- **FR-1.6:** The system SHALL implement backend-side debounce to prevent duplicate order creation from rapid repeated submissions (e.g., double-click). Duplicate requests within a debounce window with the same idempotency key SHALL return the original order response.
- **FR-1.7:** The system SHALL perform an **inventory check** after order creation. If any item is out of stock, the order SHALL transition to `out_of_stock` status, the customer SHALL be notified, and no payment SHALL be attempted.

### FR-2: Price Calculation

- **FR-2.1:** The system SHALL calculate line item totals (unit price x quantity) for each cart item.
- **FR-2.2:** The system SHALL calculate shipping cost based on the selected shipping method.
- **FR-2.3:** The system SHALL compute a grand total = sum of line items + shipping cost.
- **FR-2.4:** All monetary values SHALL be represented as integers in the smallest currency unit (e.g., cents) to avoid floating-point errors.

### FR-3: Invoice Generation

- **FR-3.1:** The system SHALL generate an invoice containing: order ID, line items with prices, shipping cost, grand total, customer details, and timestamp.
- **FR-3.2:** Each invoice SHALL have a unique invoice number.
- **FR-3.3:** The invoice SHALL be persisted and retrievable via API.

### FR-4: Payment Processing

- **FR-4.1:** The system SHALL charge the customer the full order amount via a third-party billing provider (e.g., Stripe, PayPal).
- **FR-4.2:** The system SHALL use a **payment provider abstraction** (strategy pattern) that allows selecting between payment providers without changing business logic.
- **FR-4.3:** On **payment success**, the system SHALL transition the order to "payment_confirmed" status and proceed to shipment.
- **FR-4.4:** On **payment failure**, the system SHALL transition the order to "payment_failed" (held) status and notify the customer. The order remains held — no automatic retry of payment.
- **FR-4.5:** Payment calls SHALL be idempotent — retrying with the same order ID SHALL NOT result in double charges.

### FR-5: Shipment

- **FR-5.1:** The system SHALL initiate shipment via a third-party shipping provider (e.g., FedEx, DHL).
- **FR-5.2:** The system SHALL use a **shipping provider abstraction** (strategy pattern) that allows selecting between shipping providers without changing business logic.
- **FR-5.3:** The system SHALL store and return a tracking number per shipment.
- **FR-5.4:** The system SHALL support **split shipping** — one order can produce multiple shipments, each with its own tracking number and status. The **system decides the split based on warehouse/fulfillment center availability** (not customer choice).
- **FR-5.5:** On **shipping provider unavailability**, the system SHALL:
  - Hold the shipment and retry with a **circuit breaker** pattern + **exponential backoff**.
  - After exhausting retries (circuit open), send a notification to **support staff** for manual intervention.

### FR-6: Notifications

- **FR-6.1:** The system SHALL send email notifications to the customer at the following stages:
  - Order confirmed (order created successfully)
  - Payment processed (payment succeeded or failed/held)
  - Shipped (each shipment, with tracking number)
  - Delivered (per shipment)
- **FR-6.2:** The notification system SHALL use a **channel abstraction** that supports email now and allows adding SMS/push notification channels later without changing the event producers.
- **FR-6.3:** Notification delivery failures SHALL NOT block the main order flow (fire-and-forget with retry).

### FR-7: Order Status & Lifecycle

The system SHALL track orders through the following statuses:

| Status | Description |
|---|---|
| `pending` | Order created, awaiting inventory check |
| `out_of_stock` | One or more items unavailable — order held, customer notified |
| `inventory_confirmed` | All items in stock, awaiting price calculation |
| `priced` | Total calculated, awaiting invoice |
| `invoiced` | Invoice generated, awaiting payment |
| `payment_confirmed` | Payment succeeded |
| `payment_failed` | Payment failed — order held, customer notified |
| `shipping_pending` | Awaiting shipment initiation |
| `partially_shipped` | Some items shipped (split shipping) |
| `shipped` | All items shipped |
| `delivered` | All shipments delivered |
| `shipment_held` | Shipping provider unavailable — retrying / escalated to support |

- **FR-7.1:** Each status transition SHALL emit a domain event.
- **FR-7.2:** The system SHALL expose an API endpoint to query current order status.

### FR-8: Admin / Support API

- **FR-8.1:** The system SHALL expose an admin API endpoint to **manually retry** a held shipment.
- **FR-8.2:** The system SHALL expose an admin API endpoint to **cancel** a held shipment.
- **FR-8.3:** Admin endpoints SHALL require elevated authorization (support staff role).

---

## 3. Non-Functional Requirements

### NFR-1: Architecture

- **NFR-1.1:** The system SHALL be built as microservices communicating via events (event-driven architecture).
- **NFR-1.2:** The system SHALL use AWS primitives (e.g., SQS, SNS, EventBridge, Lambda, DynamoDB, API Gateway) as the primary infrastructure.
- **NFR-1.3:** Services SHALL be loosely coupled — each service owns its own data store.

### NFR-2: Reliability

- **NFR-2.1:** All API endpoints SHALL be idempotent for safe retries.
- **NFR-2.2:** Event delivery SHALL use at-least-once semantics; consumers SHALL handle duplicate events.
- **NFR-2.3:** The system SHALL implement dead-letter queues (DLQ) for failed event processing.
- **NFR-2.4:** Backend debounce SHALL use an idempotency key (client-provided or derived) with a configurable time window.
- **NFR-2.5:** Circuit breaker for shipping SHALL have configurable thresholds (failure count, reset timeout).

### NFR-3: Observability

- **NFR-3.1:** All services SHALL emit structured logs with correlation IDs (order ID) for distributed tracing.
- **NFR-3.2:** Critical failures (payment failures, shipping holds, DLQ entries) SHALL trigger alerts.

### NFR-4: Security

- **NFR-4.1:** Payment details SHALL NOT be stored by our system — they are passed directly to the payment provider (PCI compliance via tokenization).
- **NFR-4.2:** API endpoints SHALL require authentication (assumption: auth is handled by an upstream API Gateway/middleware, out of scope to implement).
- **NFR-4.3:** Inter-service communication SHALL be within a private VPC / use IAM-based auth.

### NFR-5: Performance

- **NFR-5.1:** Order creation (synchronous part) SHALL respond within 2 seconds under normal load.
- **NFR-5.2:** Asynchronous processing (payment, shipment, notification) has no strict latency SLA but should complete within minutes under normal conditions.

---

## 4. User Stories

### US-1: Place an Order
**As a** customer,
**I want to** submit my shopping cart with payment details and shipping preference,
**So that** I can purchase the items.

**Acceptance Criteria:**
- I send a single API request with cart items, payment info, and shipping method
- I receive an order ID and confirmation status
- If I accidentally double-submit, only one order is created

### US-2: Receive Invoice
**As a** customer,
**I want to** receive an invoice for my order,
**So that** I have a record of what I'm being charged.

**Acceptance Criteria:**
- Invoice is generated automatically after pricing
- Invoice contains itemized breakdown and total
- I can retrieve my invoice via API

### US-3: Pay for Order
**As a** customer,
**I want to** have my payment processed automatically after order creation,
**So that** I don't have to take additional action.

**Acceptance Criteria:**
- Payment is charged to my provided payment method
- On success, order proceeds to shipping
- On failure, I receive an email that my order is held

### US-4: Track Shipment
**As a** customer,
**I want to** receive tracking numbers for my shipments,
**So that** I can track my deliveries.

**Acceptance Criteria:**
- Each shipment has its own tracking number
- If my order is split-shipped, I get multiple tracking numbers
- I can query order status via API to see shipment details

### US-5: Receive Status Emails
**As a** customer,
**I want to** receive email updates at each stage of my order,
**So that** I stay informed without checking manually.

**Acceptance Criteria:**
- Email sent on: order confirmed, payment processed, shipped (per shipment), delivered
- Payment failure email clearly states my order is held

### US-6: Out of Stock Notification
**As a** customer,
**I want to** be notified if items in my order are out of stock,
**So that** I know why my order cannot proceed.

**Acceptance Criteria:**
- Inventory is checked after order creation
- If any item is unavailable, order moves to `out_of_stock`
- I receive an email notification about the stock issue

### US-7: Shipping Failure Handling
**As a** support staff member,
**I want to** be notified when a shipment cannot be fulfilled after retries,
**So that** I can intervene manually.

**Acceptance Criteria:**
- System retries with exponential backoff
- Circuit breaker prevents cascading failures
- After retries exhausted, support receives notification

### US-8: Admin Shipment Management
**As a** support staff member,
**I want to** manually retry or cancel held shipments,
**So that** I can resolve shipping issues that automatic retries couldn't fix.

**Acceptance Criteria:**
- I can retry a held shipment via admin API
- I can cancel a held shipment via admin API
- Customer is notified of the outcome

---

## 5. Assumptions

1. Product catalog and pricing data are available from an existing service/database (not designed here).
2. **Guest checkout** — no customer accounts. Customer info is provided per order. No upstream auth for customers (API Gateway may still handle rate limiting / API keys).
3. Single currency for now — all prices in one currency.
4. Shipping providers push delivery status updates via webhooks (we consume them).
5. Email sending uses AWS SES or similar managed service.
6. No UI — all interactions are via REST API.
7. Inventory data is available from an existing service/database (not designed here, but we query it).

---

## 6. Resolved Questions

| # | Question | Resolution |
|---|---|---|
| 1 | Guest checkout or accounts required? | **Guest checkout** — customer info embedded in each order |
| 2 | Expected order volume? | **Design for scale** — queue-based event-driven architecture handles variable load |
| 3 | Inventory check needed? | **Yes** — added `out_of_stock` status and inventory validation step (FR-1.7) |
| 4 | Who decides split shipping? | **System decides** based on warehouse/fulfillment center availability |
| 5 | Support API for held shipments? | **Yes** — admin endpoints for manual retry and cancel (FR-8) |

---

## 7. Next Steps

Once requirements are approved:
1. **`/sc:design`** — System architecture, microservice boundaries, event flows, REST API contracts, data models
2. **`/sc:workflow`** — Implementation plan and task breakdown
