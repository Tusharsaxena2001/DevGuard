import { describe, expect, it } from "vitest";
import { safeText } from "./safe-text.js";

const ch = (...codes: number[]): string => String.fromCharCode(...codes);
const INVISIBLE = new RegExp(`[${ch(0x200b)}-${ch(0x200f)}${ch(0x2028)}-${ch(0x202e)}${ch(0x2066)}-${ch(0x2069)}${ch(0xfeff)}${ch(0x61c)}]`);

describe("safeText", () => {
  it("replaces C0/C1 controls", () => {
    expect(safeText(`a${ch(0x1b)}[0m\nb${ch(0)}c${ch(0x7f)}d${ch(0x9b)}e`)).toBe("a?[0m?b?c?d?e");
  });

  it.each([
    ["bidi override", `gnp.${ch(0x202e)}txt.exe`],
    ["bidi isolate", `a${ch(0x2066)}b${ch(0x2069)}c`],
    ["zero-width space", `pass${ch(0x200b)}word`],
    ["left-to-right mark", `a${ch(0x200e)}b`],
    ["line separator", `a${ch(0x2028)}b`],
    ["paragraph separator", `a${ch(0x2029)}b`],
    ["byte order mark", `${ch(0xfeff)}file`],
    ["arabic letter mark", `a${ch(0x61c)}b`],
  ])("neutralises %s so a file name cannot visually spoof a path", (_name, input) => {
    expect(INVISIBLE.test(input)).toBe(true); // the fixture really contains the character
    expect(INVISIBLE.test(safeText(input))).toBe(false);
    expect(safeText(input)).toContain("?");
  });

  it("keeps ordinary text, including non-ASCII letters", () => {
    const text = `src/caf${ch(0xe9)}/${ch(0x4e2d, 0x6587)}.ts`;
    expect(safeText(text)).toBe(text);
  });

  it("truncates long text", () => {
    expect(safeText("x".repeat(300))).toHaveLength(203);
  });
});
