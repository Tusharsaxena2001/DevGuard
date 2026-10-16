import { describe, expect, it } from "vitest";
import { describeError } from "./format.js";

describe("describeError", () => {
  it("adds the stable reason codes of a rejected field, never anything else", () => {
    const error = { code: "validation_failed", message: "The request is invalid.", issues: [{ path: "url", code: "invalid_userinfo" }, { path: "url", code: "invalid_userinfo" }] };
    expect(describeError(error)).toBe("The request is invalid. Reason: invalid_userinfo.");
  });

  it("keeps the plain message when there are no issues", () => {
    expect(describeError({ code: "conflict", message: "Someone else changed this." })).toBe("Someone else changed this.");
  });
});
