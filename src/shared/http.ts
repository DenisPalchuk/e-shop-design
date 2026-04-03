import { APIGatewayProxyResultV2, APIGatewayProxyEventV2 } from "aws-lambda";
import { AppError, buildErrorResponse } from "./errors";

export function jsonResponse(
  statusCode: number,
  body: unknown,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function errorResponse(
  err: AppError,
  requestId: string,
): APIGatewayProxyResultV2 {
  const { statusCode, body } = buildErrorResponse(err, requestId);
  return jsonResponse(statusCode, body);
}

/** Parse the route from an API Gateway V2 event. */
export function parseRoute(event: APIGatewayProxyEventV2): {
  method: string;
  path: string;
} {
  // V2 routeKey format: "POST /v1/orders"
  const [method, ...pathParts] = event.routeKey.split(" ");
  return { method: method.toUpperCase(), path: pathParts.join(" ") };
}

export function getPathParam(
  event: APIGatewayProxyEventV2,
  name: string,
): string | undefined {
  return event.pathParameters?.[name];
}
