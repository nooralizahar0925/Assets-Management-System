/**
 * Proves the seed produced an organisation someone can actually sign in to and
 * use: the credentials work, the session resolves permissions, and the
 * dashboard has figures rather than zeroes.
 *
 * Run against the test database with: npx tsx scripts/seed.check.ts --test
 */
if (process.argv.includes("--test")) {
  const port = process.env.TEST_DB_PORT ?? "5443";
  process.env.DATABASE_URL ??= `postgres://ams_app:ams_app@localhost:${port}/ams_test`;
  process.env.MIGRATION_DATABASE_URL ??= `postgres://ams:ams@localhost:${port}/ams_test`;
  process.env.APP_ENCRYPTION_KEY ??=
    "0000000000000000000000000000000000000000000000000000000000000001";
}

const password = process.env.SEED_PASSWORD ?? "demo1234";

function check(label: string, ok: boolean, detail = "") {
  process.stdout.write(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? ` — ${detail}` : ""}\n`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const { POST: login } = await import("../src/app/api/admin/auth/login/route");
  const { GET: me } = await import("../src/app/api/admin/auth/me/route");
  const { GET: summary } = await import("../src/app/api/v1/dashboard/summary/route");

  for (const email of [
    "admin@demo.local", "manager@demo.local",
    "technician@demo.local", "viewer@demo.local",
  ]) {
    const res = await login(new Request("http://api.test/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://api.test" },
      body: JSON.stringify({ email, password }),
    }));
    check(`sign in as ${email}`, res.status === 200, `status ${res.status}`);

    if (res.status !== 200) continue;
    const cookie = res.headers.get("set-cookie") ?? "";
    const session = /ams_session=([^;]+)/.exec(cookie)?.[1] ?? "";

    const whoami = await me(new Request("http://api.test/api/admin/auth/me", {
      headers: { cookie: `ams_session=${session}` },
    }));
    const body = (await whoami.json()) as {
      user?: { permissions?: string[]; name?: string };
    };
    check(
      `  session resolves permissions`,
      (body.user?.permissions?.length ?? 0) > 0,
      `${body.user?.name}: ${body.user?.permissions?.length ?? 0} permissions`,
    );

    if (email === "admin@demo.local") {
      const dash = await summary(new Request("http://api.test/api/v1/dashboard/summary", {
        headers: { cookie: `ams_session=${session}` },
      }));
      // The route wraps collections in `data`; the web client unwraps it.
      const { data } = (await dash.json()) as {
        data: { totals: { assets: number; active_assignments: number; overdue: number } };
      };
      check("  dashboard counts assets", data.totals.assets > 0,
        `${data.totals.assets} assets`);
      check("  dashboard shows live custody", data.totals.active_assignments > 0,
        `${data.totals.active_assignments} checked out`);
      check("  overdue report has something to show", data.totals.overdue > 0,
        `${data.totals.overdue} overdue`);
    }
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err: unknown) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  },
);
