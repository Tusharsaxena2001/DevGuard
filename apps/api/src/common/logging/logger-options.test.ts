import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { createLoggerOptions } from "./logger-options.js";

function logOnce(payload: Record<string, unknown>): string {
  let out = "";
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  const { level, redact } = createLoggerOptions({ LOG_LEVEL: "info" });
  pino({ level, redact: { paths: [...redact.paths], censor: redact.censor } }, sink).info(payload, "event");
  return out;
}

describe("logger redaction", () => {
  const sensitive = "sensitive-" + "value-123";

  it.each([
    ["authorization header", { req: { headers: { authorization: `Bearer ${sensitive}` } } }],
    ["cookie header", { req: { headers: { cookie: `session=${sensitive}` } } }],
    ["set-cookie response header", { res: { headers: { "set-cookie": [`session=${sensitive}`] } } }],
    ["nested password", { body: { password: sensitive } }],
    ["nested token", { body: { token: sensitive } }],
    ["nested secret", { device: { secret: sensitive } }],
    ["hash fields", { user: { passwordHash: sensitive }, device: { secretHash: sensitive }, enrollment: { tokenHash: sensitive } }],
    ["top-level password", { password: sensitive }],
    ["device secret (enroll response)", { res: { deviceSecret: sensitive } }],
    ["top-level device secret", { deviceSecret: sensitive }],
  ])("redacts %s", (_name, payload) => {
    const line = logOnce(payload);
    expect(line).not.toContain(sensitive);
    expect(line).toContain("[REDACTED]");
  });

  it("keeps non-sensitive fields", () => {
    expect(logOnce({ route: "/health" })).toContain("/health");
  });
});
