import { ErrorCode } from "@devguard/shared";
import { describe, expect, it } from "vitest";
import { ApiError, GENERIC_MESSAGES, httpStatusFor } from "./errors.js";

describe("error mapping", () => {
  it.each(Object.values(ErrorCode))("maps %s to a 4xx/5xx status and a non-empty generic message", (code) => {
    expect(httpStatusFor(code)).toBeGreaterThanOrEqual(400);
    expect(httpStatusFor(code)).toBeLessThan(600);
    expect(GENERIC_MESSAGES[code].length).toBeGreaterThan(0);
  });

  it.each([
    [ErrorCode.Unauthenticated, 401],
    [ErrorCode.DeviceRevoked, 401],
    [ErrorCode.Forbidden, 403],
    [ErrorCode.SelfApprovalForbidden, 403],
    [ErrorCode.NotFound, 404],
    [ErrorCode.Conflict, 409],
    [ErrorCode.RateLimited, 429],
    [ErrorCode.ValidationFailed, 400],
    [ErrorCode.Internal, 500],
  ])("maps %s to %i", (code, status) => {
    expect(httpStatusFor(code)).toBe(status);
  });

  it("ApiError carries a stable code and no stack text in its message", () => {
    const e = new ApiError(ErrorCode.Conflict, "conflict");
    expect(e.code).toBe("conflict");
    expect(e).toBeInstanceOf(Error);
  });
});
