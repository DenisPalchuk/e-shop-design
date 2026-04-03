import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { validateCreateOrder } from "./validation";
import { init } from "./context";
import { OrderDocument, CreateOrderResponse, GetOrderResponse } from "./types";
import { AppError, internalError } from "../../shared/errors";
import { createLogger } from "../../shared/logger";
import { generateOrderId, generateRequestId } from "../../shared/ids";
import {
  errorResponse,
  getPathParam,
  jsonResponse,
  parseRoute,
} from "../../shared/http";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleCreateOrder(
  event: APIGatewayProxyEventV2,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const logger = createLogger(undefined, requestId);

  // Parse body
  let rawBody: unknown;
  try {
    rawBody = event.body ? JSON.parse(event.body) : {};
  } catch {
    const err = new AppError(
      "VALIDATION_ERROR",
      "Request body is not valid JSON",
      400,
    );
    return errorResponse(err, requestId);
  }

  // Resolve idempotency key — body first, then header
  const headerKey =
    event.headers?.["x-idempotency-key"] ??
    event.headers?.["X-Idempotency-Key"];

  // Validate input (throws AppError on failure)
  const input = validateCreateOrder(rawBody, headerKey);
  const { idempotencyKey } = input;

  const childLogger = logger.child({ correlationId: idempotencyKey });
  childLogger.info("Processing POST /v1/orders", {
    shippingMethod: input.shippingMethod,
    itemCount: input.items.length,
    customerEmail: input.customer.email,
  });

  const { ordersRepository, idempotencyRepository, ordersEvents } =
    await init(childLogger);

  // --- Idempotency check ---
  const cached = await idempotencyRepository.check(idempotencyKey);
  if (cached) {
    childLogger.info("Returning cached idempotent response", {
      orderId: cached.orderId,
    });
    return jsonResponse(200, cached);
  }

  // --- Create order ---
  const orderId = generateOrderId();
  const now = new Date();
  const paymentTokenExpiresAt = new Date(now.getTime() + 30 * 60 * 1000);

  const order: OrderDocument = {
    _id: orderId,
    status: "pending",
    customer: {
      name: input.customer.name,
      email: input.customer.email,
      shippingAddress: input.customer.shippingAddress,
      billingAddress: input.customer.billingAddress,
    },
    items: input.items,
    shippingMethod: input.shippingMethod,
    paymentProvider: input.payment.provider,
    paymentToken: input.payment.token,
    grandTotalCents: null,
    invoiceId: null,
    statusHistory: [{ status: "pending", timestamp: now.toISOString() }],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    paymentTokenExpiresAt: paymentTokenExpiresAt.toISOString(),
  };

  await ordersRepository.insert(order);
  await ordersEvents.publishOrderCreated(order);

  // --- Build response ---
  const response: CreateOrderResponse = {
    orderId,
    status: "pending",
    items: order.items,
    shippingMethod: order.shippingMethod,
    customer: { email: order.customer.email },
    createdAt: order.createdAt,
  };

  // --- Store idempotency record ---
  await idempotencyRepository.store(idempotencyKey, orderId, response);

  childLogger.info("Order created successfully", { orderId });
  return jsonResponse(201, response);
}

async function handleGetOrder(
  event: APIGatewayProxyEventV2,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const orderId = getPathParam(event, "orderId") ?? "";
  const logger = createLogger(orderId, requestId);

  logger.info("Processing GET /v1/orders/{orderId}", { orderId });

  if (!orderId) {
    const err = new AppError(
      "NOT_FOUND",
      "orderId path parameter is missing",
      404,
    );
    return errorResponse(err, requestId);
  }

  const { ordersRepository } = await init(logger);
  const order = await ordersRepository.findById(orderId);

  const response: GetOrderResponse = {
    orderId: order._id,
    status: order.status,
    customer: {
      name: order.customer.name,
      email: order.customer.email,
      shippingAddress: order.customer.shippingAddress,
    },
    items: order.items,
    shippingMethod: order.shippingMethod,
    shippingCostCents: null,
    grandTotalCents: order.grandTotalCents,
    invoiceId: order.invoiceId,
    payment: {
      status: order.status === "pending" ? "pending" : "processed",
      provider: order.paymentProvider,
    },
    shipments: [],
    statusHistory: order.statusHistory,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };

  logger.info("Order fetched and returned", { orderId });
  return jsonResponse(200, response);
}

// ---------------------------------------------------------------------------
// Lambda entry point
// ---------------------------------------------------------------------------

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const requestId = generateRequestId();
  const logger = createLogger(undefined, requestId);

  try {
    const { method, path } = parseRoute(event);

    logger.info("Received request", { method, path, requestId });

    // POST /v1/orders
    if (method === "POST" && path === "/v1/orders") {
      return await handleCreateOrder(event, requestId);
    }

    // GET /v1/orders/{orderId}
    if (method === "GET" && /^\/v1\/orders\/[^/]+$/.test(path)) {
      return await handleGetOrder(event, requestId);
    }

    logger.warn("Route not found", { method, path });
    return jsonResponse(404, {
      error: {
        code: "NOT_FOUND",
        message: `Route ${method} ${path} not found`,
        requestId,
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      logger.warn("Request failed with application error", {
        code: err.code,
        message: err.message,
        httpStatus: err.httpStatus,
      });
      return errorResponse(err, requestId);
    }

    logger.error("Unhandled error", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });

    return errorResponse(
      internalError("An unexpected error occurred"),
      requestId,
    );
  }
};
