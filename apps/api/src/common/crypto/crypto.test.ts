import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwords.js";
import { constantTimeEquals, generateSecret, sha256Hex } from "./tokens.js";

describe("passwords (argon2id)", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });

  it("salts: the same password hashes differently each time", async () => {
    expect(await hashPassword("same-password-1")).not.toBe(await hashPassword("same-password-1"));
  });

  it.each(["", "!seed-no-login", "not-a-hash"])("never verifies against a non-argon2 stored value %j", async (stored) => {
    expect(await verifyPassword(stored, "anything")).toBe(false);
  });
});

describe("tokens", () => {
  it("generates prefixed, unique, high-entropy secrets", () => {
    const a = generateSecret("dgt");
    const b = generateSecret("dgt");
    expect(a).toMatch(/^dgt_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("hashes deterministically to 64 hex chars", () => {
    expect(sha256Hex("x")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("x")).toBe(sha256Hex("x"));
    expect(sha256Hex("x")).not.toBe(sha256Hex("y"));
  });

  it("compares in constant time and treats different lengths as unequal", () => {
    expect(constantTimeEquals("abc", "abc")).toBe(true);
    expect(constantTimeEquals("abc", "abd")).toBe(false);
    expect(constantTimeEquals("abc", "abcd")).toBe(false);
  });
});
