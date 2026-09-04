import { describe, it, expect } from "vitest";
import { query } from "../db";
import {
  PERMISSIONS,
  SYSTEM_ROLES,
  API_SCOPE_PERMISSIONS,
  type PermissionKey,
} from "./permissions";

describe("the permission vocabulary", () => {
  it("uses resource:verb keys throughout", () => {
    for (const p of PERMISSIONS) {
      expect(p.key, `${p.key} should be resource:verb`).toMatch(
        /^[a-z]+(?:_[a-z]+)*:[a-z]+$/,
      );
    }
  });

  it("has no duplicates", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every permission a label and a description a customer can act on", () => {
    for (const p of PERMISSIONS) {
      expect(p.label.length, `${p.key} label`).toBeGreaterThan(3);
      expect(p.description.length, `${p.key} description`).toBeGreaterThan(20);
      expect(p.group.length, `${p.key} group`).toBeGreaterThan(2);
    }
  });

  it("seeds the database table from the same list", async () => {
    // The constant is the source of truth; the table exists so role_permissions
    // can carry a foreign key. They must not drift.
    const rows = await query<{ key: string }>("SELECT key FROM permissions");
    expect(rows.map((r) => r.key).sort()).toEqual(
      PERMISSIONS.map((p) => p.key).sort(),
    );
  });
});

describe("system roles", () => {
  it("defines the four roles the product ships with", () => {
    expect(Object.keys(SYSTEM_ROLES).sort()).toEqual([
      "Administrator", "Manager", "Technician", "Viewer",
    ]);
  });

  it("grants only permissions that exist", () => {
    const known = new Set<string>(PERMISSIONS.map((p) => p.key));
    for (const [name, role] of Object.entries(SYSTEM_ROLES)) {
      for (const key of role.permissions) {
        expect(known.has(key), `${name} grants unknown ${key}`).toBe(true);
      }
    }
  });

  it("gives the administrator every permission", () => {
    expect([...SYSTEM_ROLES.Administrator.permissions].sort()).toEqual(
      PERMISSIONS.map((p) => p.key).sort(),
    );
  });

  it("gives a viewer no permission that changes anything", () => {
    for (const key of SYSTEM_ROLES.Viewer.permissions) {
      expect(key.endsWith(":read")).toBe(true);
    }
  });

  it("does not let a technician manage users, roles or keys", () => {
    const tech = new Set<string>(SYSTEM_ROLES.Technician.permissions);
    for (const forbidden of ["users:write", "roles:write", "api_keys:write"]) {
      expect(tech.has(forbidden), `technician should not have ${forbidden}`).toBe(false);
    }
  });
});

describe("published API scopes", () => {
  it("expands each of the four documented scopes", () => {
    expect(Object.keys(API_SCOPE_PERMISSIONS).sort()).toEqual([
      "admin", "assets:read", "assets:write", "reports:read",
    ]);
  });

  it("expands admin to everything, so the published contract still holds", () => {
    expect([...API_SCOPE_PERMISSIONS.admin].sort()).toEqual(
      PERMISSIONS.map((p) => p.key).sort(),
    );
  });

  it("expands only to permissions that exist", () => {
    const known = new Set<string>(PERMISSIONS.map((p) => p.key));
    for (const [scope, keys] of Object.entries(API_SCOPE_PERMISSIONS)) {
      for (const key of keys as PermissionKey[]) {
        expect(known.has(key), `${scope} expands to unknown ${key}`).toBe(true);
      }
    }
  });

  it("keeps assets:write a superset of assets:read", () => {
    const read = new Set<string>(API_SCOPE_PERMISSIONS["assets:read"]);
    for (const key of read) {
      expect(API_SCOPE_PERMISSIONS["assets:write"]).toContain(key);
    }
  });
});
