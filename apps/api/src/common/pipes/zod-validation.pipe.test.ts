import { ErrorCode } from "@devguard/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import { ZodValidationPipe } from "./zod-validation.pipe.js";

const schema = z.object({ name: z.string().min(1), password: z.string().min(12) }).strict();

describe("ZodValidationPipe", () => {
  const pipe = new ZodValidationPipe(schema);

  it("returns parsed data for valid input", () => {
    const value = { name: "a", password: "p".repeat(12) };
    expect(pipe.transform(value)).toEqual(value);
  });

  it.each([
    ["wrong type", { name: 5, password: "p".repeat(12) }],
    ["missing field", { name: "a" }],
    ["unknown field (strict)", { name: "a", password: "p".repeat(12), extra: 1 }],
    ["not an object", "nope"],
    ["null", null],
  ])("throws validation_failed for %s", (_name, input) => {
    try {
      pipe.transform(input);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe(ErrorCode.ValidationFailed);
      expect((error as ApiError).issues.length).toBeGreaterThan(0);
    }
  });

  it("reports only path and code, never the rejected value", () => {
    const secretLooking = "short-leak"; // 10 chars: fails min(12), so it is the rejected value
    try {
      pipe.transform({ name: "a", password: secretLooking });
      expect.unreachable();
    } catch (error) {
      const text = JSON.stringify({ message: (error as ApiError).message, issues: (error as ApiError).issues });
      expect(text).not.toContain(secretLooking);
      expect((error as ApiError).issues[0]).toEqual({ path: "password", code: "too_small" });
    }
  });
});
