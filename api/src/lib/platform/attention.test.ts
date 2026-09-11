import { describe, it, expect } from "vitest";
import { withPlatform } from "./db";
import { createOrg, createUserWithRole } from "../../test/org";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";
import { createAsset } from "../domain/assets";
import { needsAttention, type AttentionItem } from "./attention";

/**
 * The console's front page.
 *
 * Every test makes its own customer and looks only for that one. This suite
 * runs against a database every other suite has been writing to, so asserting
 * on the length of the whole list would be asserting on the rest of the run.
 */

const day = 86_400_000;
const isoDate = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);

async function customer(columns: Record<string, unknown> = {}): Promise<string> {
  const id = await createOrg(`Attention ${Date.now()}-${Math.random()}`);
  const entries = Object.entries(columns);
  if (entries.length > 0) {
    const sets = entries.map(([key], i) => `${key} = $${i + 2}`).join(", ");
    await withPlatform((c) =>
      c.query(`UPDATE organizations SET ${sets} WHERE id = $1`,
        [id, ...entries.map(([, v]) => v)]),
    );
  }
  return id;
}

const find = (list: AttentionItem[], id: string) =>
  list.find((item) => item.org_id === id);

const kinds = (item: AttentionItem | undefined) =>
  (item?.reasons ?? []).map((r) => r.kind);

describe("trials", () => {
  it("lists one ending inside the window", async () => {
    const id = await customer({ trial_ends_at: isoDate(7) });
    expect(kinds(find(await needsAttention(), id))).toContain("trial-ending");
  });

  it("says the date, so the operator knows how urgent it is", async () => {
    const id = await customer({ trial_ends_at: isoDate(3) });
    const reason = find(await needsAttention(), id)!
      .reasons.find((r) => r.kind === "trial-ending")!;
    expect(reason.detail).toMatch(/Trial ends \d{1,2} \w{3} \d{4}/);
  });

  it("ignores one that is months away", async () => {
    const id = await customer({ trial_ends_at: isoDate(90) });
    expect(kinds(find(await needsAttention(), id))).not.toContain("trial-ending");
  });

  it("still lists one that lapsed last week", async () => {
    // Nothing suspends a customer automatically, so a lapsed trial stays on
    // the list until somebody decides what to do about it.
    const id = await customer({ trial_ends_at: isoDate(-7) });
    expect(kinds(find(await needsAttention(), id))).toContain("trial-ending");
  });
});

describe("renewals", () => {
  it("lists one due inside the month", async () => {
    const id = await customer({ renews_on: isoDate(14) });
    expect(kinds(find(await needsAttention(), id))).toContain("renewal-due");
  });

  it("ignores one due next year", async () => {
    const id = await customer({ renews_on: isoDate(200) });
    expect(kinds(find(await needsAttention(), id))).not.toContain("renewal-due");
  });
});

describe("customers with no plan", () => {
  it("lists them, because they can use nothing that is sold", async () => {
    const id = await customer({ plan_code: null });
    expect(kinds(find(await needsAttention(), id))).toContain("no-plan");
  });

  it("says nothing about one that is on a plan", async () => {
    const id = await customer();
    expect(kinds(find(await needsAttention(), id))).not.toContain("no-plan");
  });
});

describe("customers over a limit", () => {
  it("lists them, and says by how much", async () => {
    // Their writes are being refused right now, which makes this the most
    // urgent thing on the page.
    const id = await customer({ limit_overrides: JSON.stringify({ max_assets: 1 }) });
    const admin = await createUserWithRole(id, "Administrator");
    const ctx: Ctx = {
      orgId: id,
      actor: {
        type: "user", id: admin.id, label: "Admin", scopes: ["admin"],
        permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
        locationScope: null,
      },
    };
    await createAsset(ctx, { name: "One" });
    await createAsset(ctx, { name: "Two" });

    const item = find(await needsAttention(), id);
    expect(kinds(item)).toContain("over-limit");
    expect(item!.reasons.find((r) => r.kind === "over-limit")!.detail)
      .toMatch(/2 assets against a limit of 1/);
  });

  it("says nothing about one comfortably inside its limit", async () => {
    const id = await customer({ limit_overrides: JSON.stringify({ max_assets: 500 }) });
    expect(kinds(find(await needsAttention(), id))).not.toContain("over-limit");
  });
});

describe("suspended customers", () => {
  it("lists one suspended long enough to need a decision", async () => {
    // Reinstate, or delete and stop holding their data.
    const id = await customer({
      suspended_at: new Date(Date.now() - 120 * day).toISOString(),
    });
    expect(kinds(find(await needsAttention(), id))).toContain("long-suspended");
  });

  it("says nothing about one suspended last week", async () => {
    const id = await customer({
      suspended_at: new Date(Date.now() - 7 * day).toISOString(),
    });
    expect(find(await needsAttention(), id)).toBeUndefined();
  });

  it("does not chase a suspended customer about renewals or trials", async () => {
    // Their access is off. A renewal reminder for somebody who cannot sign in
    // is noise that hides the customers who need ringing.
    const id = await customer({
      suspended_at: new Date(Date.now() - 7 * day).toISOString(),
      renews_on: isoDate(7),
      trial_ends_at: isoDate(7),
    });
    expect(find(await needsAttention(), id)).toBeUndefined();
  });
});

describe("dormant customers", () => {
  it("lists one nobody has signed into for months", async () => {
    const id = await customer({
      created_at: new Date(Date.now() - 200 * day).toISOString(),
    });
    const item = find(await needsAttention(), id);
    expect(kinds(item)).toContain("dormant");
    expect(item!.reasons.find((r) => r.kind === "dormant")!.detail)
      .toMatch(/never signed in|has ever signed in/i);
  });

  it("gives a customer created this week a chance first", async () => {
    // "Nobody has signed in" is only news once they have had the opportunity.
    const id = await customer();
    expect(kinds(find(await needsAttention(), id))).not.toContain("dormant");
  });
});

describe("the shape of the list", () => {
  it("counts a customer once however many reasons they have", async () => {
    // Otherwise the badge says nine when there are four customers to ring.
    const id = await customer({
      created_at: new Date(Date.now() - 200 * day).toISOString(),
      plan_code: null,
      renews_on: isoDate(7),
    });

    const list = await needsAttention();
    expect(list.filter((item) => item.org_id === id)).toHaveLength(1);
    expect(kinds(find(list, id)).sort())
      .toEqual(["dormant", "no-plan", "renewal-due"]);
  });

  it("puts the customers with most to discuss first", async () => {
    const busy = await customer({
      created_at: new Date(Date.now() - 200 * day).toISOString(),
      plan_code: null,
      renews_on: isoDate(7),
    });
    const quiet = await customer({ renews_on: isoDate(7) });

    const list = await needsAttention();
    const positionOf = (id: string) => list.findIndex((i) => i.org_id === id);
    expect(positionOf(busy)).toBeLessThan(positionOf(quiet));
  });

  it("says nothing about a customer who is simply fine", async () => {
    const id = await customer({
      renews_on: isoDate(200), trial_ends_at: null,
    });
    expect(find(await needsAttention(), id)).toBeUndefined();
  });
});
