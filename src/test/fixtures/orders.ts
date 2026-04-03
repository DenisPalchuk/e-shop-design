import { APIGatewayProxyEventV2 } from "aws-lambda";
import { CreateOrderResponse } from "../../services/orders/types";

export function createOrderEvent(
  idempotencyKey: string,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /v1/orders",
    rawPath: "/v1/orders",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      "x-idempotency-key": idempotencyKey,
    },
    requestContext: {} as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false,
    pathParameters: undefined,
    stageVariables: undefined,
    queryStringParameters: undefined,
    cookies: undefined,
    body: JSON.stringify({
      customer: {
        name: "Jane Doe",
        email: "jane@example.com",
        shippingAddress: {
          line1: "1 Main St",
          city: "Warsaw",
          state: "Mazowieckie",
          postalCode: "00-001",
          country: "PL",
        },
        billingAddress: {
          line1: "1 Main St",
          city: "Warsaw",
          state: "Mazowieckie",
          postalCode: "00-001",
          country: "PL",
        },
      },
      items: [{ productId: "prod_123", quantity: 1 }],
      shippingMethod: "standard",
      payment: {
        provider: "stripe",
        token: "tok_test_1234",
      },
    }),
  };
}

export function createCompletedOrderResponse(): CreateOrderResponse {
  return {
    orderId: "ord_1",
    status: "pending",
    items: [{ productId: "prod_123", quantity: 1 }],
    shippingMethod: "standard",
    customer: { email: "jane@example.com" },
    createdAt: "2026-04-03T12:00:00.000Z",
  };
}
