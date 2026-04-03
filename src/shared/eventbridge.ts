import { EventBridgeClient } from "@aws-sdk/client-eventbridge";

export const DEFAULT_BUS_NAME = "checkout-events";

let ebClient: EventBridgeClient | null = null;

/**
 * Returns a singleton EventBridgeClient, reused across warm Lambda invocations.
 */
export function getEventBridgeClient(): EventBridgeClient {
  if (!ebClient) {
    ebClient = new EventBridgeClient({
      region: process.env.AWS_REGION ?? "us-east-1",
    });
  }
  return ebClient;
}
