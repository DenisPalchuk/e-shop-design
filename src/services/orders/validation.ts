import { z } from "zod";
import { ErrorDetail, validationError, AppError } from "../../shared/errors";

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const addressSchema = z.object({
  line1: z.string().min(1, "line1 is required"),
  line2: z.string().optional(),
  city: z.string().min(1, "city is required"),
  state: z.string().min(1, "state is required"),
  postalCode: z.string().min(1, "postalCode is required"),
  country: z.string().min(1, "country is required"),
});

const orderItemSchema = z.object({
  productId: z.string().min(1, "productId must be a non-empty string"),
  variantId: z.string().optional(),
  quantity: z
    .number()
    .int("quantity must be an integer")
    .positive("quantity must be a positive integer"),
});

// ---------------------------------------------------------------------------
// Main request schema
// ---------------------------------------------------------------------------

export const createOrderSchema = z.object({
  idempotencyKey: z.string().min(1, "idempotencyKey must be a non-empty string").optional(),
  customer: z.object({
    name: z.string().min(1, "customer.name is required"),
    email: z.string().email("customer.email must be a valid email address"),
    shippingAddress: addressSchema,
    billingAddress: addressSchema,
  }),
  items: z
    .array(orderItemSchema)
    .min(1, "items must contain at least one entry"),
  shippingMethod: z.enum(["standard", "express", "overnight"], {
    errorMap: () => ({
      message: "shippingMethod must be one of: standard, express, overnight",
    }),
  }),
  payment: z.object({
    provider: z.enum(["stripe", "paypal"], {
      errorMap: () => ({
        message: "payment.provider must be one of: stripe, paypal",
      }),
    }),
    token: z.string().min(1, "payment.token must be a non-empty string"),
  }),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

// ---------------------------------------------------------------------------
// Validation helper — converts Zod errors into our ErrorDetail format
// ---------------------------------------------------------------------------

function zodPathToField(path: (string | number)[]): string {
  return path
    .map((seg, i) =>
      typeof seg === "number" ? `[${seg}]` : i === 0 ? seg : `.${seg}`
    )
    .join("");
}

export function validateCreateOrder(
  body: unknown,
  idempotencyKeyFromHeader?: string
): CreateOrderInput & { idempotencyKey: string } {
  const result = createOrderSchema.safeParse(body);

  if (!result.success) {
    const details: ErrorDetail[] = result.error.errors.map((err) => ({
      field: zodPathToField(err.path),
      issue: err.message,
    }));
    throw validationError("Invalid order request", details);
  }

  // Resolve idempotency key: body takes precedence, then header
  const idempotencyKey =
    result.data.idempotencyKey ?? idempotencyKeyFromHeader;

  if (!idempotencyKey) {
    throw validationError("Invalid order request", [
      {
        field: "idempotencyKey",
        issue:
          "idempotencyKey is required — provide it in the request body or via the X-Idempotency-Key header",
      },
    ]);
  }

  return { ...result.data, idempotencyKey };
}

export function validateOrderId(orderId: string): void | never {
  if (!orderId || !orderId.startsWith("ord_") || orderId.length < 8) {
    throw new AppError("NOT_FOUND", `Order not found: ${orderId}`, 404);
  }
}
