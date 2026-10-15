import { describe, expect, it } from "@rstest/core";

import { parseAppearance, solarAppearance } from "@/core/settings/solar-theme";

describe("workspace appearance", () => {
  it("rejects unknown modes/cities and malformed stored preferences", () => {
    expect(parseAppearance('{"mode":"solar","city":"shanghai"}')).toEqual({
      mode: "solar",
      city: "shanghai",
    });
    expect(parseAppearance('{"mode":"auto","city":"shanghai"}')).toBeNull();
    expect(parseAppearance('{"mode":"solar","city":"unknown"}')).toBeNull();
    expect(parseAppearance("broken")).toBeNull();
  });

  it("uses actual solar seasons rather than a fixed 6am/6pm schedule", () => {
    expect(solarAppearance(new Date("2026-01-15T10:00:00Z"), "shanghai")).toBe(
      "dark",
    );
    expect(solarAppearance(new Date("2026-06-21T10:00:00Z"), "shanghai")).toBe(
      "light",
    );
    expect(solarAppearance(new Date("2026-06-21T12:00:00Z"), "shanghai")).toBe(
      "dark",
    );
    expect(solarAppearance(new Date("2026-01-15T00:00:00Z"), "beijing")).toBe(
      "light",
    );
  });
});
