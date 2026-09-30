// The daily-limit presets: the standard one is the default, and matching
// the limits back to a preset.

import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, cleanSettings } from "./backup";
import { LIMIT_PRESETS, presetOf, reviewsTooFew } from "./limits";

describe("limit presets", () => {
  it("starts on the standard preset", () => {
    expect(presetOf(DEFAULT_SETTINGS)?.id).toBe("standard");
  });

  it("names the preset the limits match, and none for other numbers", () => {
    for (const p of LIMIT_PRESETS) expect(presetOf(p)).toBe(p);
    expect(presetOf({ newPerDay: 20, reviewsPerDay: 150 })).toBeNull();
  });

  it("survives the settings cleaning unchanged", () => {
    for (const p of LIMIT_PRESETS) {
      const s = cleanSettings({ ...DEFAULT_SETTINGS, newPerDay: p.newPerDay, reviewsPerDay: p.reviewsPerDay });
      expect(presetOf(s)).toBe(p);
    }
  });

  it("no preset lets reviews pile up", () => {
    for (const p of LIMIT_PRESETS) expect(reviewsTooFew(p)).toBe(false);
    expect(reviewsTooFew({ newPerDay: 30, reviewsPerDay: 200 })).toBe(true);
  });
});
