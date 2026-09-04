import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "../db";
import { createOrg } from "../../test/org";
import { mintApiKey, readApiKey } from "./apikey";

let orgId: string;

beforeAll(async () => {
  orgId = await createOrg("Key Org");
});

const withKey = (key: string) =>
  new Request("http://x/api/v1/assets", {
    headers: { authorization: `Bearer ${key}` },
  });

describe("api keys", () => {
  it("returns the plaintext exactly once and stores only a hash", async () => {
    const { id, plaintext } = await mintApiKey(orgId, "CI", ["assets:read"]);
    // prefix.secret — readApiKey splits on the dot to look the key up by its
    // prefix, so the separator is part of the format, not an accident.
    expect(plaintext).toMatch(/^ams_live_[0-9a-f]{8}\.[A-Za-z0-9_-]{32}$/);
    const rows = await withTenant(orgId, async (c) =>
      (await c.query<{ key_hash: string }>(
        "SELECT key_hash FROM api_keys WHERE id=$1", [id],
      )).rows,
    );
    expect(rows[0].key_hash).not.toContain(plaintext);
  });

  it("authenticates a valid key and carries its scopes", async () => {
    const { plaintext } = await mintApiKey(orgId, "Reader", ["assets:read"]);
    const ctx = await readApiKey(withKey(plaintext));
    expect(ctx).toMatchObject({ orgId, actor: { type: "api_key", scopes: ["assets:read"] } });
  });

  it("rejects an unknown key", async () => {
    await expect(readApiKey(withKey("ams_live_nope"))).resolves.toBeNull();
  });

  it("rejects a revoked key", async () => {
    const { id, plaintext } = await mintApiKey(orgId, "Old", ["assets:read"]);
    await withTenant(orgId, (c) =>
      c.query("UPDATE api_keys SET revoked_at = now() WHERE id=$1", [id]),
    );
    await expect(readApiKey(withKey(plaintext))).resolves.toBeNull();
  });
});
