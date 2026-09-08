import { describe, it, expect } from "vitest";
import { createOrg } from "../../test/org";
import { systemCtx } from "../jobs/context";
import { listRules } from "./rules";


describe("what a brand-new organisation gets", () => {
  it("has notification rules without anybody creating them", async () => {
    // seedDefaultRules existed from the notifications work and had no caller
    // anywhere. Every organisation therefore had an empty rules table, and the
    // entire notification feature was dark: no overdue reminder, no
    // maintenance warning, no import summary, ever.
    const fresh = await createOrg("Freshly Seeded Org");
    const rules = await listRules(systemCtx(fresh));

    expect(rules.length).toBeGreaterThan(5);
    expect(rules.map((r) => r.event)).toContain("asset.overdue");
    expect(rules.map((r) => r.event)).toContain("import.completed");
  });

  it("gets them active, or they would be decoration", async () => {
    const fresh = await createOrg("Active Rules Org");
    const rules = await listRules(systemCtx(fresh));
    expect(rules.every((r) => r.active)).toBe(true);
  });
});
