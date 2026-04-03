type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  correlationId?: string;
  requestId?: string;
  [key: string]: unknown;
}

interface LoggerBindings {
  correlationId?: string;
  requestId?: string;
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

export class Logger {
  constructor(private readonly bindings: LoggerBindings = {}) {}

  debug(message: string, context: Record<string, unknown> = {}): void {
    this.write("debug", message, context);
  }

  info(message: string, context: Record<string, unknown> = {}): void {
    this.write("info", message, context);
  }

  warn(message: string, context: Record<string, unknown> = {}): void {
    this.write("warn", message, context);
  }

  error(message: string, context: Record<string, unknown> = {}): void {
    this.write("error", message, context);
  }

  child(bindings: LoggerBindings): Logger {
    return new Logger({
      correlationId: bindings.correlationId ?? this.bindings.correlationId,
      requestId: bindings.requestId ?? this.bindings.requestId,
    });
  }

  private write(
    level: LogLevel,
    message: string,
    context: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(this.bindings.correlationId ? { correlationId: this.bindings.correlationId } : {}),
      ...(this.bindings.requestId ? { requestId: this.bindings.requestId } : {}),
      ...(redact(context) as Record<string, unknown>),
    };
    // Lambda writes to stdout → CloudWatch
    process.stdout.write(JSON.stringify(entry) + "\n");
  }
}

export function createLogger(correlationId?: string, requestId?: string): Logger {
  return new Logger({ correlationId, requestId });
}

// Module-level root logger; callers should use .child() to attach IDs
export const rootLogger = new Logger();
