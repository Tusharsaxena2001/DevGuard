import { describe, expect, it } from "vitest";
import { classifyFreshness, DEFAULT_MAX_STALE_MINUTES, MAX_ALLOWED_STALE_MINUTES, parseMaxStaleMinutes } from "./policy-freshness.js";

const NOW = new Date("2026-06-01T12:00:00.000Z");
const ago = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();

describe("classifyFreshness (ADR-004)", () => {
  it.each([
    [0, "fresh"],
    [5, "fresh"],
    [6, "stale_ok"],
    [60, "stale_ok"],
    [61, "expired"],
    [60 * 24, "expired"],
  ] as const)("a policy fetched %i minutes ago is %s with a 60 minute limit", (minutes, expected) => {
    expect(classifyFreshness(ago(minutes), NOW, 60)).toBe(expected);
  });

  it("is missing when there is nothing cached", () => {
    expect(classifyFreshness(undefined, NOW, 60)).toBe("missing");
  });

  it.each([["a timestamp far in the future", ago(-600)], ["garbage", "not a date"], ["empty", ""]])("treats %s as expired", (_name, value) => {
    expect(classifyFreshness(value, NOW, 60)).toBe("expired");
  });

  it("tolerates a minute of clock skew into the future", () => {
    expect(classifyFreshness(ago(-0.5), NOW, 60)).toBe("fresh");
  });

  it("uses the configured limit", () => {
    expect(classifyFreshness(ago(30), NOW, 120)).toBe("stale_ok");
    expect(classifyFreshness(ago(30), NOW, 10)).toBe("expired");
  });
});

describe("parseMaxStaleMinutes", () => {
  it.each([["90", 90], [" 15 ", 15], ["1", 1]])("accepts %j", (raw, expected) => {
    expect(parseMaxStaleMinutes(raw)).toBe(expected);
  });

  it("caps the limit at 24 hours", () => {
    expect(parseMaxStaleMinutes("99999")).toBe(MAX_ALLOWED_STALE_MINUTES);
    expect(parseMaxStaleMinutes("1440")).toBe(1440);
  });

  it.each([[undefined], [""], ["0"], ["-5"], ["1.5"], ["abc"], ["60m"], ["abc1"]])("falls back to the default for %j (a typo never switches the limit off)", (raw) => {
    expect(parseMaxStaleMinutes(raw)).toBe(DEFAULT_MAX_STALE_MINUTES);
  });
});
