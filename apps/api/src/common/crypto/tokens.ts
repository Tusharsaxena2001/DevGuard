import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 256 bits of randomness, URL-safe. The prefix makes leaked values recognisable (and greppable by scanners). */
export function generateSecret(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

/** SHA-256 is adequate for high-entropy random secrets (unlike passwords, which use argon2id). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Constant-time comparison; unequal lengths are simply unequal. */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
