// The tenant-scoped connection: least privilege, subject to row-level security.
process.env.DATABASE_URL ??=
  "postgres://ams_app:ams_app@localhost:5433/ams_test";

// The owner connection, used only for provisioning a tenant in test fixtures —
// the same split the seed script and the sign-up path use.
process.env.MIGRATION_DATABASE_URL ??=
  "postgres://ams:ams@localhost:5433/ams_test";
