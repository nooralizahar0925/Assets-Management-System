import { randomBytes } from "node:crypto";
import { Client } from "pg";

/**
 * Creates the first operator account.
 *
 * There is a chicken and egg here: the console manages platform administrators,
 * and only a platform administrator can open the console. This is how the first
 * one exists. It runs on the server, over the platform connection, and is the
 * only way into that plane that does not already require being in it.
 *
 * Re-running for an address that already exists resets its password rather than
 * failing, because the realistic reason to run this twice is that somebody has
 * locked themselves out.
 *
 *   npm run platform:admin -- --email ops@example.com --name "Noor"
 */

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * Readable, and long enough not to matter.
 *
 * base64url so it can be pasted out of a terminal and into a browser without
 * anything mangling it - which is what actually happens to a password printed
 * once and never shown again.
 */
const generatePassword = () => randomBytes(18).toString("base64url");

async function main(): Promise<void> {
  const email = arg("email");
  const name = arg("name") ?? email;

  if (!email) {
    throw new Error(
      'Usage: npm run platform:admin -- --email ops@example.com --name "Your Name"',
    );
  }

  const connectionString = process.env.PLATFORM_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "PLATFORM_DATABASE_URL is not set. This account can read every tenant " +
        "in the database, so it is created over the platform connection and " +
        "nothing else - see .env.example.",
    );
  }

  const password = arg("password") ?? generatePassword();
  const generated = !arg("password");

  // Imported here rather than at the top: the password hasher pulls in the
  // whole auth module, and that is wasted work when the arguments are wrong.
  const { hashPassword } = await import("../src/lib/auth/password");
  const hash = await hashPassword(password);

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string; existed: boolean }>(
      `INSERT INTO platform_admins (email, password_hash, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (lower(email)) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             name          = EXCLUDED.name,
             disabled_at   = NULL
       RETURNING id, (xmax <> 0) AS existed`,
      [email, hash, name],
    );

    const { existed } = rows[0];
    const base = process.env.APP_BASE_URL ?? "http://localhost:3000";

    process.stdout.write(
      `\n${existed ? "Reset" : "Created"} the platform account for ${email}.\n\n` +
        `  Sign in at ${base}/platform\n` +
        `  Password: ${generated ? password : "(the one you supplied)"}\n\n` +
        (generated
          ? "Copy it now - it is not stored anywhere and cannot be shown again.\n"
          : "") +
        "This account can see and change every customer. Treat it accordingly.\n",
    );
  } finally {
    await client.end();
  }
}

// Both names: `npm run platform:admin` runs the TypeScript through tsx, and a
// bundled build would run platform-admin.js. Checking only one made the
// production seed a silent no-op once already.
if (/(^|[\\/])platform-admin\.(ts|js)$/.test(process.argv[1] ?? "")) {
  main().then(
    () => process.exit(0),
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
