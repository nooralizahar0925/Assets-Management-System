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
  const port = process.env.TEST_DB_PORT ?? "5443";
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
async function provision(name: string, slug: string): Promise<Provisioned> {
  const owner = await ownerClient();
  try {
    const { rows } = await owner.query<{ id: string }>(
      "SELECT id FROM organizations WHERE slug = $1",
      [slug],
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
      [id, name, slug],
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
      `INSERT INTO users (org_id, email, password_hash, name, role_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [orgId, email, hash, name, rows[0]?.id ?? null],
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

/** The demo accounts, by the role each one holds. */
export const SEED_USERS = {
  admin: "admin@demo.local",
  manager: "manager@demo.local",
  technician: "technician@demo.local",
  viewer: "viewer@demo.local",
} as const;

/**
 * The second customer, and the operator who looks after both.
 *
 * One customer is not a list. Worse, a single healthy one leaves the console's
 * front page empty, which looks identical to a console that is broken. This
 * one is deliberately in trouble: days from the end of a trial and holding
 * more assets than its cap allows, so "needs attention" has both kinds of
 * reason on it and the limit warnings have something to warn about.
 */
export const SEED_STRAINED = {
  name: "Sinar Rental",
  slug: "sinar",
  admin: "admin@sinar.local",
  operator: "ops@demo.local",
  /** Below what the organisation already holds, on purpose. */
  assetCap: 5,
  assets: 8,
} as const;

/**
 * The operator account, and the demo organisation's plan.
 *
 * Neither is ever overwritten. Re-running the seed against a database somebody
 * has been using must not reset a password or move a customer back onto the
 * plan they were sold two changes ago.
 */
async function seedPlatform(demoOrgId: string): Promise<void> {
  const { hashPassword } = await import("../src/lib/auth/password");
  const hash = await hashPassword(password());
  const owner = await ownerClient();
  try {
    const { rowCount } = await owner.query(
      `INSERT INTO platform_admins (email, password_hash, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (lower(email)) DO NOTHING`,
      [SEED_STRAINED.operator, hash, "Demo Operator"],
    );

    // Said out loud, because the alternative is a silent one. The row is left
    // exactly as it is - re-seeding must never reset a live operator password -
    // which means an account created under a different SEED_PASSWORD keeps it,
    // and somebody reading the summary below would otherwise take the printed
    // password to be the one that works.
    if (rowCount === 0) {
      process.stdout.write(
        `\n${SEED_STRAINED.operator} already exists. Its password was left ` +
          `alone.\nIf it is not the one you expect: npm run platform:admin -- ` +
          `--email ${SEED_STRAINED.operator}\n`,
      );
    }
    await owner.query(
      `UPDATE organizations SET plan_code = 'professional'
        WHERE id = $1 AND plan_code IS NULL`,
      [demoOrgId],
    );
  } finally {
    await owner.end();
  }
}

/** The customer in trouble. See SEED_STRAINED for why there is one. */
async function seedStrainedCustomer(): Promise<void> {
  const { orgId, needsSeeding, createdHere } =
    await provision(SEED_STRAINED.name, SEED_STRAINED.slug);
  if (!needsSeeding) return;

  try {
    const adminId = await createUser(
      orgId, "Administrator", "Rina Halim", SEED_STRAINED.admin,
    );
    const { createAsset } = await import("../src/lib/domain/assets");
    const ctx = adminCtx(orgId, adminId);

    for (let n = 1; n <= SEED_STRAINED.assets; n += 1) {
      await createAsset(ctx, { name: `Forklift ${n}` });
    }

    const owner = await ownerClient();
    try {
      // The cap is applied after the assets exist, not before: a limit refuses
      // writes, so seeding it first would refuse the very rows that are meant
      // to breach it. Being capped below what you already hold is also how an
      // organisation gets into this state in real life.
      await owner.query(
        `UPDATE organizations
            SET plan_code       = 'starter',
                trial_ends_at   = (now() + interval '3 days')::date,
                limit_overrides = $2::jsonb
          WHERE id = $1`,
        [orgId, JSON.stringify({ max_assets: SEED_STRAINED.assetCap })],
      );
    } finally {
      await owner.end();
    }
  } catch (err) {
    if (createdHere) await discardOrganisation(orgId);
    throw err;
  }
}

export interface SeedResult {
  orgId: string;
  users: Record<string, string>;
  /** False when the organisation was already there and nothing was written. */
  seeded: boolean;
}

/**
 * Seeds the demo organisation, or reports that it is already seeded.
 *
 * Exported so the test suite can drive it. Running it on import instead - as
 * this script used to - is why proving it worked needed a second script run by
 * hand, and a check nobody runs is a check that quietly stops being true.
 */
export async function seed(): Promise<SeedResult> {
  const { orgId, needsSeeding, createdHere } = await provision("Demo Logistics", SLUG);

  if (needsSeeding) {
    try {
      await seedInto(orgId);
    } catch (err) {
      // A half-seeded tenant is worse than none: the organisation exists, so
      // the next run would find it, see no users, and build on the leftovers.
      if (createdHere) await discardOrganisation(orgId);
      throw err;
    }
  }

  // Outside that branch, and idempotent. A database seeded before the console
  // existed has the demo organisation and none of this, and re-running the
  // seed is how anybody would expect to get the rest.
  await seedPlatform(orgId);
  await seedStrainedCustomer();

  return { orgId, users: { ...SEED_USERS }, seeded: needsSeeding };
}

async function main() {
  const { seeded } = await seed();
  if (!seeded) {
    // Not "nothing to do": the console's own rows are seeded either way, and
    // saying otherwise would be a lie on the run that adds them.
    process.stdout.write(
      `The "${SLUG}" organisation is already seeded; it was left alone.\n`,
    );
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
  // Two levels, because a flat list of sites demonstrates nothing: the tree is
  // what the location filter, the branch scoping and the stock-take by
  // location are all built on.
  const serverRoom = await createLocation(ctx, {
    name: "Server room", parent_id: jakarta.id,
  });
  await createLocation(ctx, { name: "Workshop", parent_id: bekasi.id });
  await createLocation(ctx, { name: "Yard", parent_id: bekasi.id });

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

  // A third category, and the only one whose assets carry no serial number:
  // it is what makes the by-category chart worth looking at, and it is how a
  // customer sees that "asset" here does not have to mean a physical object.
  const licences = await createCategory(ctx, {
    name: "Software licences", kind: "media",
    field_schema: {
      fields: [
        { key: "seats", label: "Seats", type: "number", required: false },
        { key: "license_expiry", label: "Licence expires", type: "date",
          required: false },
        { key: "vendor", label: "Vendor", type: "string", required: false },
      ],
    },
  });

  type SeedStatus = "available" | "in_use" | "maintenance" | "retired" | "lost";

  const laptop = (n: number, status: SeedStatus) =>
    createAsset(ctx, {
      name: `ThinkPad T14 #${n}`,
      category_id: laptops.id,
      location_id: n % 2 === 0 ? jakarta.id : bekasi.id,
      serial_no: `LT-2026-${String(n).padStart(4, "0")}`,
      status,
      purchase_date: "2026-01-15",
      purchase_cost: 18_500_000,
      // A warranty inside the warning window, so the expiring-soon panel and
      // the warranty notification have something real to work on.
      custom: {
        os: "Windows 11", ram_gb: 16,
        warranty_end: n % 4 === 0 ? "2026-10-15" : "2029-01-15",
      },
    });

  /**
   * Sixteen laptops across every status.
   *
   * The count and the spread both matter: the status donut with three slices
   * and eleven assets looks like a broken dashboard rather than a small one,
   * and retired and lost are exactly the states a customer asks about first -
   * a demo that never shows them cannot answer the question.
   */
  const LAPTOP_STATUSES: SeedStatus[] = [
    "available", "available", "available", "available", "available",
    "available", "available", "available",
    "maintenance", "maintenance",
    "in_use", "in_use", "in_use",
    "retired", "retired",
    "lost",
  ];

  const created = [];
  for (const [index, status] of LAPTOP_STATUSES.entries()) {
    created.push(await laptop(index + 1, status));
  }

  for (let n = 1; n <= 6; n += 1) {
    created.push(await createAsset(ctx, {
      name: `Toyota 8FG25 forklift #${n}`,
      category_id: forklifts.id,
      location_id: warehouse.id,
      serial_no: `FL-${String(n).padStart(3, "0")}`,
      status: n === 6 ? "maintenance" : "available",
      purchase_date: "2025-06-01",
      purchase_cost: 425_000_000,
      // One service already inside the warning window, so the maintenance
      // panel is not empty on the first screen anybody sees.
      custom: {
        hours: 1200 + n * 130,
        next_service_at: n === 1 ? "2026-09-20" : "2026-12-01",
      },
    }));
  }

  const LICENCES = [
    { name: "AutoCAD 2026", seats: 12, vendor: "Autodesk", expiry: "2026-09-25" },
    { name: "Microsoft 365 E3", seats: 80, vendor: "Microsoft", expiry: "2027-03-31" },
    { name: "Adobe Creative Cloud", seats: 6, vendor: "Adobe", expiry: "2027-01-14" },
  ];

  for (const [index, licence] of LICENCES.entries()) {
    created.push(await createAsset(ctx, {
      name: licence.name,
      category_id: licences.id,
      location_id: index === 0 ? serverRoom.id : jakarta.id,
      status: "in_use",
      purchase_date: "2026-01-05",
      purchase_cost: 24_000_000 + index * 8_000_000,
      custom: {
        seats: licence.seats, vendor: licence.vendor,
        license_expiry: licence.expiry,
      },
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
      `  Sign in at http://localhost:3400/signin (docker compose)\n` +
      `             or http://localhost:5473/signin (npm run dev)\n\n` +
      `    admin@demo.local       Administrator\n` +
      `    manager@demo.local     Manager\n` +
      `    technician@demo.local  Technician\n` +
      `    viewer@demo.local      Viewer\n\n` +
      `  Password: ${process.env.SEED_PASSWORD ? "(from SEED_PASSWORD)" : password()}\n\n` +
      `Sign in as each to see how much of the interface a role changes.\n\n` +
      `  The platform console is at /platform. A different sign-in, for you\n` +
      `  rather than for a customer:\n\n` +
      `    ${SEED_STRAINED.operator}          Operator\n\n` +
      `  It has two customers on it, one of them over a limit and three days\n` +
      `  from the end of a trial.\n`,
  );
}

/**
 * Whether this was run as a script rather than imported.
 *
 * Both extensions, because there are two of it: `npm run seed` runs the
 * TypeScript through tsx, and `npm run seed:prod` runs the bundle that esbuild
 * writes to dist-scripts/seed.js - which is the one a real deployment uses.
 * Checking only for "seed.ts" made the production seed a silent no-op: exit
 * zero, no output, nothing written, and no way to tell from the outside.
 */
export const invokedAsScript = (argv1: string | undefined): boolean =>
  /(^|[\\/])seed\.(ts|js)$/.test(argv1 ?? "");

// Importing this from a test must not seed, and must certainly not call
// process.exit in the middle of a suite.
if (invokedAsScript(process.argv[1])) {
  main().then(
    () => process.exit(0),
    (err: unknown) => {
      process.stderr.write(`${String(err)}\n`);
      process.exit(1);
    },
  );
}
