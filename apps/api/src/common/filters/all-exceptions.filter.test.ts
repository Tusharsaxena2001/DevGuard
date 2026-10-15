import { type ArgumentsHost, ConflictException, ForbiddenException, Logger, NotFoundException } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { ErrorCode } from "@devguard/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../errors.js";
import { AllExceptionsFilter } from "./all-exceptions.filter.js";

function run(exception: unknown): { status: number; body: Record<string, unknown> } {
  let status = 0;
  let body: Record<string, unknown> = {};
  const res = {
    status(s: number) {
      status = s;
      return this;
    },
    json(b: Record<string, unknown>) {
      body = b;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { status, body };
}

describe("AllExceptionsFilter", () => {
  let errorLog: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorLog = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("maps ApiError to its code, status and issues", () => {
    const { status, body } = run(new ApiError(ErrorCode.ValidationFailed, "bad", [{ path: "name", code: "too_small" }]));
    expect(status).toBe(400);
    expect(body).toEqual({ code: "validation_failed", message: "bad", issues: [{ path: "name", code: "too_small" }] });
  });

  it("omits issues when there are none", () => {
    expect(run(new ApiError(ErrorCode.Forbidden, "no")).body).toEqual({ code: "forbidden", message: "no" });
  });

  it.each([
    [new NotFoundException("secret internal path /srv/x"), 404, "not_found"],
    [new ForbiddenException(), 403, "forbidden"],
    [new ConflictException(), 409, "conflict"],
    [new ThrottlerException(), 429, "rate_limited"],
  ])("maps framework HTTP errors to a generic body (%#)", (exception, status, code) => {
    const result = run(exception);
    expect(result.status).toBe(status);
    expect(result.body["code"]).toBe(code);
    expect(JSON.stringify(result.body)).not.toContain("/srv/x");
  });

  it("maps body-parser style errors (malformed JSON) to 400 validation_failed", () => {
    const result = run(Object.assign(new SyntaxError("Unexpected token } in JSON at position 9"), { status: 400, type: "entity.parse.failed" }));
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ code: "validation_failed", message: "The request is invalid." });
  });

  it("turns unknown errors into a generic 500 with no stack, message or connection details", () => {
    const leaky = new Error("connect ECONNREFUSED postgresql://user:hunter2@db:5432/x");
    const result = run(leaky);
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ code: "internal_error", message: "An internal error occurred." });
    expect(JSON.stringify(result.body)).not.toContain("hunter2");
    // The log line carries the error name only.
    const logged = errorLog.mock.calls.flat().join(" ");
    expect(logged).not.toContain("hunter2");
  });

  it.each([["a string", "boom"], ["undefined", undefined], ["an object", { status: 700 }]])("handles a thrown %s", (_n, thrown) => {
    expect(run(thrown).status).toBe(500);
  });
});
