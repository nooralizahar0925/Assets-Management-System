import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { seedRolesForOrg } from "./seed-permissions";
import type { Ctx } from "../src/lib/http/handler";
import type { PermissionKey } from "../src/lib/auth/permissions";

// db.ts builds its connection pool the moment it is imported, and imports are
// hoisted above everything else in this file - so a static import would capture
// DATABASE_URL before the --test block below has a chance to set it. Everything
// that touches the database is therefore imported inside main().

/**
 * Fills an empty database with an organisation you can actually sign in to.
 *
 * Until this runs there is no user, so the sign-in page has nothing to accept
 * and every screen behind it is unreachable. It also lays down enough of a
 * register that the dashboard, the reports and the charts have something real
 * to show rather than six zeroes.
 *
 * Idempotent: re-running finds the organisation by slug and stops, so it is
 * safe to leave in a start-up script.
 */

const SLUG = "demo";
const isProduction = process.env.NODE_ENV === "production";

/** Points the seed at the throwaway database, matching src/test/setup.ts. */
if (process.argv.includes("--test")) {
  const port = process.env.TEST_DB_PORT ?? "5433";
  process.env.MIGRATION_DATABASE_URL ??= `postgres://ams:ams@localhost:${port}/ams_test`;
  process.env.DATABASE_URL ??= `postgres://ams_app:ams_app@localhost:${port}/ams_test`;
  process.env.APP_ENCRYPTION_KEY ??=
    "0000000000000000000000000000000000000000000000000000000000000001";
}

/**
 * The seed creates accounts whose password is either well known or sitting in
 * the environment, which is exactly what a demo needs and exactly what a
 * production database must not be given by accident.
 */
function password(): string {
  const fromEnv = process.env.SEED_PASSWORD;
  if (fromEnv) return fromEnv;
  if (isProduction) {
    throw new Error(
      "SEED_PASSWORD is not set. Refusing to seed a production database with " +
        "a well-known password.",
    );
  }
  return "demo1234";
}

const ownerClient = async () => {
  const owner = new Client({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  });
  await owner.connect();
  return owner;
};

interface Provisioned {
  orgId: string;
  /** False when an earlier run already finished; nothing more to do. */
  needsSeeding: boolean;
  /** True when this run created the organisation, so this run may remove it. */
  createdHere: boolean;
}

/**
 * Creating an organisation is a bootstrap operation: ams_app is denied it.
 *
 * Existence of the organisation is not the same as being seeded. A run that
 * fails partway - as the first one here did, at the user step - leaves the
 * organisation and its roles behind, and treating that as "already seeded"
 * would report success over a tenant nobody can sign in to. The admin account
 * is what "seeded" means, so that is what is checked.
 */
async function provision(name: string): Promise<Provisioned> {
  const owner = await ownerClient();
  try {
    const { rows } = await owner.query<{ id: string }>(
      "SELECT id FROM organizations WHERE slug = $1",
      [SLUG],
    );

    if (rows[0]) {
      const orgId = rows[0].id;
      const { rows: users } = await owner.query(
        "SELECT 1 FROM users WHERE org_id = $1 LIMIT 1",
        [orgId],
      );
      // Seeding roles is idempotent, so this also repairs a run that died
      // between creating the organisation and creating its roles.
      if (users.length === 0) await seedRolesForOrg(owner, orgId);
      return { orgId, needsSeeding: users.length === 0, createdHere: false };
    }

    const id = randomUUID();
    await owner.query(
      "INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, $2, $3)",
      [id, name, SLUG],
    );
    await seedRolesForOrg(owner, id);
    return { orgId: id, needsSeeding: true, createdHere: true };
  } finally {
    await owner.end();
  }
}

/** Undoes a failed first run, so the next attempt starts from clean ground. */
async function discardOrganisation(orgId: string): Promise<void> {
  const owner = await ownerClient();
  try {
    // Every tenant table references organizations ON DELETE CASCADE.
    await owner.query("DELETE FROM organizations WHERE id = $1", [orgId]);
  } finally {
    await owner.end();
  }
}

const LEGACY_ROLE: Record<string, string> = {
  Administrator: "admin",
  Manager: "manager",
  Technician: "technician",
  Viewer: "viewer",
};

async function createUser(
  orgId: string, roleName: string, name: string, email: string,
): Promise<string> {
  const { hashPassword } = await import("../src/lib/auth/password");
  const { withTenant } = await import("../src/lib/db");
  const hash = await hashPassword(password());
  return withTenant(orgId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      "SELECT id FROM roles WHERE org_id = $1 AND lower(name) = lower($2)",
      [orgId, roleName],
    );
    const inserted = await c.query<{ id: string }>(
      `INSERT INTO users (org_id, email, password_hash, name, role, role_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [orgId, email, hash, name, LEGACY_ROLE[roleName] ?? "viewer", rows[0]?.id ?? null],
    );
    return inserted.rows[0].id;
  });
}

/** Everything the seed does runs as an administrator of the new organisation. */
function adminCtx(orgId: string, userId: string): Ctx {
  return {
    orgId,
    actor: {
      type: "user",
      id: userId,
      label: "Seed",
      scopes: ["admin"],
      // The seed writes through the same domain functions the API uses, so it
      // needs the permissions those functions check.
      permissions: [
        "assets:read", "assets:write", "custody:write",
        "categories:read", "categories:write",
        "locations:read", "locations:write",
      ] as PermissionKey[],
      locationScope: null,
    },
  };
}

async function main() {
  const { orgId, needsSeeding, createdHere } = await provision("Demo Logistics");
  if (!needsSeeding) {
    process.stdout.write(`"${SLUG}" is already seeded. Nothing to do.
`);
    return;
  }

  try {
    await seedInto(orgId);
  } catch (err) {
    // A half-seeded tenant is worse than none: the organisation exists, so the
    // next run would find it, see no users, and build on the leftovers.
    if (createdHere) await discardOrganisation(orgId);
    throw err;
  }
}

async function seedInto(orgId: string) {
  const { createCategory } = await import("../src/lib/domain/categories");
  const { createLocation } = await import("../src/lib/domain/locations");
  const { createAsset } = await import("../src/lib/domain/assets");
  const { checkOut } = await import("../src/lib/domain/assignments");

  const adminId = await createUser(
    orgId, "Administrator", "Ayu Lestari", "admin@demo.local",
  );
  await createUser(orgId, "Manager", "Bagus Wibowo", "manager@demo.local");
  const technicianId = await createUser(
    orgId, "Technician", "Rina Kusuma", "technician@demo.local",
  );
  await createUser(orgId, "Viewer", "Dedi Santoso", "viewer@demo.local");

  const ctx = adminCtx(orgId, adminId);

  const jakarta = await createLocation(ctx, {
    name: "Jakarta HQ", address: "Jl. Sudirman 52, Jakarta",
  });
  const warehouse = await createLocation(ctx, {
    name: "Warehouse", parent_id: jakarta.id,
  });
  const bekasi = await createLocation(ctx, {
    name: "Bekasi Plant", address: "Kawasan Industri MM2100, Bekasi",
  });

  const laptops = await createCategory(ctx, {
    name: "Laptops", kind: "it",
    field_schema: {
      fields: [
        { key: "os", label: "Operating system", type: "enum", required: false,
          options: ["Windows 11", "macOS", "Ubuntu"] },
        { key: "ram_gb", label: "RAM (GB)", type: "number", required: false },
        { key: "warranty_end", label: "Warranty ends", type: "date", required: false },
      ],
    },
  });
  const forklifts = await createCategory(ctx, {
    name: "Forklifts", kind: "equipment",
    field_schema: {
      fields: [
        { key: "hours", label: "Running hours", type: "number", required: false },
        { key: "next_service_at", label: "Next service", type: "date", required: false },
      ],
    },
  });

  const laptop = (n: number, status: "available" | "in_use" | "maintenance") =>
    createAsset(ctx, {
      name: `ThinkPad T14 #${n}`,
      category_id: laptops.id,
      location_id: n % 2 === 0 ? jakarta.id : bekasi.id,
      serial_no: `LT-2026-${String(n).padStart(4, "0")}`,
      status,
      purchase_date: "2026-01-15",
      purchase_cost: 18_500_000,
      custom: { os: "Windows 11", ram_gb: 16, warranty_end: "2029-01-15" },
    });

  const created = [];
  for (let n = 1; n <= 8; n += 1) {
    created.push(await laptop(n, n <= 5 ? "available" : "maintenance"));
  }

  for (let n = 1; n <= 3; n += 1) {
    created.push(await createAsset(ctx, {
      name: `Toyota 8FG25 forklift #${n}`,
      category_id: forklifts.id,
      location_id: warehouse.id,
      serial_no: `FL-${String(n).padStart(3, "0")}`,
      status: "available",
      purchase_date: "2025-06-01",
      purchase_cost: 425_000_000,
      custom: { hours: 1200 + n * 130, next_service_at: "2026-10-01" },
    }));
  }

  // Two live assignments, one of them already overdue, so the dashboard's
  // custody figures and the overdue report are not both zero on day one.
  const day = 24 * 60 * 60 * 1000;
  await checkOut(ctx, created[0].id, {
    assignee_type: "user",
    assignee_id: technicianId,
    due_at: new Date(Date.now() + 14 * day).toISOString(),
    note: "Field survey kit",
  });
  await checkOut(ctx, created[1].id, {
    assignee_type: "user",
    assignee_id: technicianId,
    due_at: new Date(Date.now() - 3 * day).toISOString(),
    note: "Overdue on purpose, so the overdue report has something to show",
  });

  process.stdout.write(
    `\nSeeded "Demo Logistics" with ${created.length} assets.\n\n` +
      `  Sign in at http://localhost:3000/signin (docker compose)\n` +
      `             or http://localhost:5173/signin (npm run dev)\n\n` +
      `    admin@demo.local       Administrator\n` +
      `    manager@demo.local     Manager\n` +
      `    technician@demo.local  Technician\n` +
      `    viewer@demo.local      Viewer\n\n` +
      `  Password: ${process.env.SEED_PASSWORD ? "(from SEED_PASSWORD)" : password()}\n\n` +
      `Sign in as each to see how much of the interface a role changes.\n`,
  );
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  },
);
