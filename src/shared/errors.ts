export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export interface ErrorDetail {
  field: string;
  issue: string;
}

export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
    requestId: string;
  };
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly message: string,
    public readonly httpStatus: number,
    public readonly details?: ErrorDetail[]
  ) {
    super(message);
    this.name = "AppError";
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function validationError(
  message: string,
  details: ErrorDetail[]
): AppError {
  return new AppError("VALIDATION_ERROR", message, 400, details);
}

export function notFoundError(message: string): AppError {
  return new AppError("NOT_FOUND", message, 404);
}

export function conflictError(message: string): AppError {
  return new AppError("CONFLICT", message, 409);
}

export function internalError(message: string): AppError {
  return new AppError("INTERNAL_ERROR", message, 500);
}

export function buildErrorResponse(
  error: AppError,
  requestId: string
): { statusCode: number; body: ErrorResponse } {
  return {
    statusCode: error.httpStatus,
    body: {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
        requestId,
      },
    },
  };
}
