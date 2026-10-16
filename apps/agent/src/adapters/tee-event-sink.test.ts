import { describe, expect, it } from "vitest";
import type { SecurityEventInput } from "@devguard/shared";
import { createTeeEventSink } from "./tee-event-sink.js";

const event = { idempotencyKey: "key-000001" } as SecurityEventInput;

describe("createTeeEventSink", () => {
  it("records in every sink", async () => {
    const seen: string[] = [];
    await createTeeEventSink([{ record: async () => void seen.push("a") }, { record: async () => void seen.push("b") }]).record(event);
    expect(seen).toEqual(["a", "b"]);
  });

  it("still records in the later sinks when an earlier one fails, then reports the first failure", async () => {
    const seen: string[] = [];
    const sink = createTeeEventSink([
      { record: async () => Promise.reject(new Error("log disk full")) },
      { record: async () => void seen.push("spool") },
      { record: async () => Promise.reject(new Error("second failure")) },
    ]);
    await expect(sink.record(event)).rejects.toThrow("log disk full");
    expect(seen).toEqual(["spool"]);
  });
});
