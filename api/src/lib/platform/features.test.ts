import { describe, it, expect } from "vitest";
import { FEATURES, FEATURE_KEYS, ALWAYS_ON, isFeatureKey } from "./features";
import { sources } from "../../test/sources";



describe("the feature catalogue", () => {
  it("has no duplicate keys", () => {
    expect(new Set(FEATURE_KEYS).size).toBe(FEATURE_KEYS.length);
  });

  it("describes every feature in terms a customer would recognise", () => {
    // These strings end up on a price list and in the console beside a switch
    // somebody is about to flip for a paying customer. "misc flag" will not do.
    for (const feature of FEATURES) {
      expect(feature.label.length, feature.key).toBeGreaterThan(3);
      expect(feature.description.length, feature.key).toBeGreaterThan(40);
      expect(feature.group.length, feature.key).toBeGreaterThan(2);
    }
  });

  it("keeps the register on, whatever else is sold", () => {
    expect(ALWAYS_ON).toContain("core");
  });

  it("recognises its own keys and nothing else", () => {
    expect(isFeatureKey("stocktake")).toBe(true);
    expect(isFeatureKey("stocktakes")).toBe(false);
    expect(isFeatureKey("")).toBe(false);
  });

  it("gates only features that something actually checks", async () => {
    // The mirror of the webhook-events guard, and the same failure mode: a
    // feature nobody enforces is a line on a price list that means nothing,
    // and the customer finds out by using what they did not buy.
    const gated = new Set<string>();
    for (const source of await sources()) {
      const text = source.text;
      for (const match of text.matchAll(
        /(?:hasFeature|requireFeature)\(\s*\w+\s*,\s*"([a-z_]+)"/g,
      )) {
        gated.add(match[1]);
      }
    }

    const ungated = FEATURE_KEYS
      .filter((key) => !ALWAYS_ON.includes(key))
      .filter((key) => !gated.has(key));

    expect(ungated, `sold but never enforced: ${ungated.join(", ")}`).toEqual([]);
  });

  it("names every feature that is already gated", async () => {
    // The other half of Task 61's guard, and safe to run now: a gate for a
    // feature the catalogue does not list would be a check nobody can satisfy.
    const gated = new Set<string>();
    for (const source of await sources()) {
      const text = source.text;
      for (const match of text.matchAll(
        /(?:hasFeature|requireFeature)\(\s*\w+\s*,\s*"([a-z_]+)"/g,
      )) {
        gated.add(match[1]);
      }
    }

    const unknown = [...gated].filter((key) => !isFeatureKey(key));
    expect(unknown, `gated but not in the catalogue: ${unknown.join(", ")}`).toEqual([]);
  });
});
