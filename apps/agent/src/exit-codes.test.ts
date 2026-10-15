import { expect, it } from "vitest";
import { ExitCode } from "./exit-codes.js";

it("exit codes are part of the CLI contract (the Git hook relies on them) and must not be renumbered", () => {
  expect(ExitCode).toEqual({ ok: 0, blocked: 1, usageOrConfig: 2 });
});
