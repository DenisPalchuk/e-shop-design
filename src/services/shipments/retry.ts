export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export function getRetryConfig(): RetryConfig {
  return {
    maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS ?? "5", 10),
    baseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS ?? "1000", 10),
    maxDelayMs: parseInt(process.env.RETRY_MAX_DELAY_MS ?? "30000", 10),
  };
}

/**
 * Exponential backoff formula: min(baseDelay * 2^attempt + jitter, maxDelay)
 */
export function computeDelay(attempt: number, config: RetryConfig): number {
  const jitter = Math.floor(Math.random() * 200);
  return Math.min(config.baseDelayMs * Math.pow(2, attempt) + jitter, config.maxDelayMs);
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
