import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { withTenant } from "../db";
import { createOrg, createUserWithRole } from "../../test/org";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";
import {
  inviteUser, listInvitations, revokeInvitation, acceptInvitation,
  pendingInvitationCount, EmailTakenError, InvitationInvalidError,
} from "./invitations";
import { POST as LOGIN } from "../../app/api/admin/auth/login/route";

let orgId: string;
let ctx: Ctx;
let technicianRole: string;

const unique = (p: string) =>
  `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@invite.test`;

beforeAll(async () => {
  orgId = await createOrg("Invitations Org");
  const admin = await createUserWithRole(orgId, "Administrator");
  ctx = {
    orgId,
    actor: {
      type: "user", id: admin.id, label: "Admin", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };
  technicianRole = await withTenant(orgId, async (c) =>
    (await c.query<{ id: string }>(
      "SELECT id FROM roles WHERE org_id = $1 AND lower(name) = 'technician'",
      [orgId],
    )).rows[0].id,
  );
});

beforeEach(() =>
  withTenant(orgId, (c) => c.query("DELETE FROM user_invitations")),
);

const invite = (email = unique("colleague")) =>
  inviteUser(ctx, { email, name: "Rina Kusuma", role_id: technicianRole });

describe("inviting somebody", () => {
  it("returns a token once, and stores only its hash", async () => {
    const created = await invite();
    expect(created.token.length).toBeGreaterThan(20);

    const stored = await withTenant(orgId, async (c) =>
      (await c.query<{ token_hash: string }>(
        "SELECT token_hash FROM user_invitations WHERE id = $1", [created.id],
      )).rows[0].token_hash,
    );
    expect(stored).not.toContain(created.token);
  });

  it("names the role they are being invited to", async () => {
    const created = await invite();
    expect(created.role_name).toBe("Technician");
  });

  it("expires in 72 hours, as the email promises", async () => {
    const created = await invite();
    const hours = (new Date(created.expires_at).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71);
    expect(hours).toBeLessThan(73);
  });

  it("replaces an earlier invitation rather than leaving two live tokens", async () => {
    // Somebody who lost the email asks for another. Two valid tokens, only one
    // of which anybody knows about, is a credential nobody can revoke.
    const email = unique("forgetful");
    const first = await invite(email);
    const second = await invite(email);

    expect(second.id).toBe(first.id);
    expect(second.token).not.toBe(first.token);
    expect(await listInvitations(ctx)).toHaveLength(1);

    await expect(acceptInvitation(first.token, "a-good-password"))
      .rejects.toBeInstanceOf(InvitationInvalidError);
  });

  it("refuses an address that already has an account anywhere", async () => {
    // users_email_idx is unique across the deployment, not per tenant: sign-in
    // resolves an address to one account before it knows the organisation.
    const other = await createOrg("Other Org");
    const taken = await createUserWithRole(other, "Viewer");

    await expect(
      inviteUser(ctx, { email: taken.email, name: "Clash", role_id: technicianRole }),
    ).rejects.toBeInstanceOf(EmailTakenError);
  });

  it("refuses a role that does not exist here", async () => {
    // Somebody invited to a role that is not theirs would hold no permissions
    // and be refused by every screen on their first day.
    await expect(inviteUser(ctx, {
      email: unique("wrong-role"),
      name: "Nobody",
      role_id: "00000000-0000-0000-0000-000000000000",
    })).rejects.toBeInstanceOf(InvitationInvalidError);
  });

  it("counts towards the plan's user limit before anybody accepts", async () => {
    // Otherwise twenty invitations onto a plan that allows ten are refused one
    // at a time, at acceptance, to people who have done nothing wrong.
    expect(await pendingInvitationCount(ctx)).toBe(0);
    await invite();
    await invite();
    expect(await pendingInvitationCount(ctx)).toBe(2);
  });
});

describe("accepting one", () => {
  it("creates an account that can sign in", async () => {
    const created = await invite();
    const { email } = await acceptInvitation(created.token, "chosen-by-them");

    const res = await LOGIN(new Request("http://api.test/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "chosen-by-them" }),
    }));
    expect(res.status).toBe(200);
  });

  it("gives them the role they were invited to", async () => {
    const created = await invite();
    const { userId } = await acceptInvitation(created.token, "chosen-by-them");

    const role = await withTenant(orgId, async (c) =>
      (await c.query<{ name: string }>(
        `SELECT r.name FROM users u JOIN roles r ON r.id = u.role_id
          WHERE u.id = $1`,
        [userId],
      )).rows[0].name,
    );
    expect(role).toBe("Technician");
  });

  it("cannot be used twice", async () => {
    const created = await invite();
    await acceptInvitation(created.token, "chosen-by-them");

    await expect(acceptInvitation(created.token, "again"))
      .rejects.toBeInstanceOf(InvitationInvalidError);
  });

  it("refuses an expired invitation", async () => {
    const created = await invite();
    await withTenant(orgId, (c) =>
      c.query(
        "UPDATE user_invitations SET expires_at = now() - interval '1 hour' WHERE id = $1",
        [created.id],
      ),
    );

    await expect(acceptInvitation(created.token, "too-late"))
      .rejects.toBeInstanceOf(InvitationInvalidError);
  });

  it("says the same thing for an expired, used and invented token", async () => {
    // This endpoint is public. Three different answers would let somebody
    // probe which invitations exist.
    const created = await invite();
    await acceptInvitation(created.token, "chosen-by-them");

    const message = async (token: string): Promise<string> => {
      try {
        await acceptInvitation(token, "whatever");
        return "accepted";
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    };

    expect(await message(created.token)).toBe(await message("not-a-real-token"));
  });

  it("stops showing in the pending list once accepted", async () => {
    const created = await invite();
    expect(await listInvitations(ctx)).toHaveLength(1);

    await acceptInvitation(created.token, "chosen-by-them");
    expect(await listInvitations(ctx)).toHaveLength(0);
  });
});

describe("revoking one", () => {
  it("makes the token worthless", async () => {
    const created = await invite();
    expect(await revokeInvitation(ctx, created.id)).toBe(true);

    await expect(acceptInvitation(created.token, "too-late"))
      .rejects.toBeInstanceOf(InvitationInvalidError);
  });

  it("says so when there was nothing to revoke", async () => {
    expect(await revokeInvitation(ctx, "00000000-0000-0000-0000-000000000000"))
      .toBe(false);
  });
});
