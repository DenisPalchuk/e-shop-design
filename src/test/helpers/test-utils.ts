import {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { handleCreateOrder } from "../../services/orders/handler";

type CreateOrderDependencies = NonNullable<Parameters<typeof handleCreateOrder>[2]>;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function withEnv(
  overrides: Record<string, string | number>,
  callback: () => Promise<void>,
): Promise<void> {
  const previous: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    process.env[key] = String(value);
  }

  return Promise.resolve()
    .then(callback)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

export function parseBody<T>(result: APIGatewayProxyStructuredResultV2): T {
  return JSON.parse(result.body ?? "{}") as T;
}

export async function handleCreateOrderResult(
  event: APIGatewayProxyEventV2,
  requestId: string,
  dependencies: CreateOrderDependencies,
): Promise<APIGatewayProxyStructuredResultV2> {
  return (await handleCreateOrder(
    event,
    requestId,
    dependencies,
  )) as APIGatewayProxyStructuredResultV2;
}
