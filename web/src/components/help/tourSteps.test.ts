import { describe, it, expect } from "vitest";
import { TOUR_STEPS } from "./tourSteps";
import { sources } from "../../test/sources";


/**
 * Every `data-tour` attribute the application actually renders.
 *
 * driver.js skips a step whose element is missing, without an error. That makes
 * a renamed element the perfect silent failure: the tour still runs, one step
 * shorter, and nobody finds out until a customer asks what happened to the bit
 * about scanning. Reading the attributes out of the source turns it into a
 * failing build.
 */
async function renderedTourAnchors(): Promise<Set<string>> {
  const anchors = new Set<string>();
  for (const { name, text } of await sources()) {
    if (name.endsWith("tourSteps.ts")) continue;
    for (const match of text.matchAll(/data-tour="([a-z-]+)"/g)) {
      anchors.add(match[1]);
    }
  }
  return anchors;
}

const anchorOf = (selector: string) =>
  selector.replace(/^\[data-tour="/, "").replace(/"\]$/, "");

describe("the first-run tour", () => {
  it("points only at elements the application renders", async () => {
    const rendered = await renderedTourAnchors();
    const missing = TOUR_STEPS
      .map((step) => anchorOf(step.element))
      .filter((anchor) => !rendered.has(anchor));

    expect(missing, `steps pointing at nothing: ${missing.join(", ")}`).toEqual([]);
  });

  it("found the anchors, so the scanner still works", async () => {
    expect((await renderedTourAnchors()).size).toBeGreaterThan(3);
  });

  it("says something on every step rather than naming the element", () => {
    for (const step of TOUR_STEPS) {
      expect(step.popover.title.length).toBeGreaterThan(3);
      expect(step.popover.description.length).toBeGreaterThan(40);
    }
  });
});
