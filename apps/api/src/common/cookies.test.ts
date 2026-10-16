import { describe, expect, it } from "vitest";
import { readCookie } from "./cookies.js";

describe("readCookie", () => {
  it.each([
    ["a=1; dg_session=tok; b=2", "dg_session", "tok"],
    ["dg_session=a%20b", "dg_session", "a b"],
    ["xdg_session=no; dg_session=yes", "dg_session", "yes"],
  ])("finds the named cookie in %j", (header, name, expected) => {
    expect(readCookie(header, name)).toBe(expected);
  });

  it.each([[undefined], [""], ["other=1"], ["dg_session"], ["dg_session=%E0%A4%A"]])("returns undefined for %j", (header) => {
    expect(readCookie(header, "dg_session")).toBeUndefined();
  });
});
