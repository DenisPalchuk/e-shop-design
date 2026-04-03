type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  correlationId?: string;
  requestId?: string;
  [key: string]: unknown;
}

function redact(value: unknown): unknown {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Mask payment tokens and any field named "token" or "paymentToken"
      if (k === "token" || k === "paymentToken") {
        redacted[k] = typeof v === "string" ? `${v.slice(0, 4)}****` : "[REDACTED]";
      } else {
        redacted[k] = redact(v);
      }
    }
    return redacted;
  }
  return value;
}

function log(
  level: LogLevel,
  message: string,
  context: Record<string, unknown> = {},
  correlationId?: string,
  requestId?: string
): void {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(correlationId ? { correlationId } : {}),
    ...(requestId ? { requestId } : {}),
    ...(redact(context) as Record<string, unknown>),
  };
  // Lambda writes to stdout → CloudWatch
  process.stdout.write(JSON.stringify(entry) + "\n");
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(bindings: { correlationId?: string; requestId?: string }): Logger;
}

export function createLogger(
  correlationId?: string,
  requestId?: string
): Logger {
  return {
    debug: (message, context = {}) =>
      log("debug", message, context, correlationId, requestId),
    info: (message, context = {}) =>
      log("info", message, context, correlationId, requestId),
    warn: (message, context = {}) =>
      log("warn", message, context, correlationId, requestId),
    error: (message, context = {}) =>
      log("error", message, context, correlationId, requestId),
    child: (bindings) =>
      createLogger(
        bindings.correlationId ?? correlationId,
        bindings.requestId ?? requestId
      ),
  };
}

// Module-level root logger; callers should use .child() to attach IDs
export const rootLogger = createLogger();
