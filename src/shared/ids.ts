import { randomBytes } from "crypto";

// URL-safe base62 alphabet (avoids ambiguous chars like 0/O, 1/l/I)
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ID_SIZE = 21; // ~125 bits of entropy

function nanoid(size = ID_SIZE): string {
  const bytes = randomBytes(size);
  let id = "";
  // Rejection-sampling to stay uniform across the 62-char alphabet
  for (let i = 0; i < size; i++) {
    // 256 / 62 = ~4.12; mask to the nearest power-of-2 minus 1 (63)
    const byte = bytes[i] & 63; // 0-63
    if (byte < ALPHABET.length) {
      id += ALPHABET[byte];
    } else {
      // Re-sample the slot from a fresh byte; keep it simple with a fallback
      id += ALPHABET[randomBytes(1)[0] % ALPHABET.length];
    }
  }
  return id;
}

export function generateOrderId(): string {
  return `ord_${nanoid(16)}`;
}

export function generateEventId(): string {
  return `evt_${nanoid(16)}`;
}

export function generateRequestId(): string {
  return `req_${nanoid(16)}`;
}

export function generateInvoiceId(): string {
  return `inv_${nanoid(16)}`;
}
