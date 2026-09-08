// The throwaway Postgres from docker-compose.test.yml. The port is overridable
// because 5433 is a common choice and may already be taken on a given machine;
// set TEST_DB_PORT for both compose and the tests.
const port = process.env.TEST_DB_PORT ?? "5433";

// The tenant-scoped connection: least privilege, subject to row-level security.
process.env.DATABASE_URL ??=
  `postgres://ams_app:ams_app@localhost:${port}/ams_test`;

// The owner connection, used only for provisioning a tenant in test fixtures -
// the same split the seed script and the sign-up path use.
process.env.MIGRATION_DATABASE_URL ??=
  `postgres://ams:ams@localhost:${port}/ams_test`;

// The platform connection: a separate role holding BYPASSRLS, because reading
// across tenants is the console's whole job. Separate from the tenant URL so a
// test that reaches for the wrong one fails loudly rather than quietly seeing
// everything.
process.env.PLATFORM_DATABASE_URL ??=
  `postgres://ams_platform:ams_platform@localhost:${port}/ams_test`;

// MinIO from docker-compose.yml, for the attachment tests. Start it with
// `docker compose up -d minio`.
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_BUCKET ??= "ams-attachments";
process.env.S3_ACCESS_KEY ??= "ams";
process.env.S3_SECRET_KEY ??= "ams-secret";

// A fixed key for tests only. Production refuses to start without a real one.
process.env.APP_ENCRYPTION_KEY ??=
  "0000000000000000000000000000000000000000000000000000000000000001";

// pg_dump and pg_restore run inside the database container: this host has no
// PostgreSQL client, and the versions have to match the server anyway. `-i`
// keeps stdin open so an archive can be piped back in for a restore.
const container = process.env.TEST_DB_CONTAINER ?? "assetsmanagementsystem-db-test-1";
process.env.PG_DUMP_COMMAND ??= `docker exec -i ${container} pg_dump`;
// pg_dump runs inside that container, so it reaches the server on the
// container's own port, not the one published to this host. Set this wherever
// PG_DUMP_COMMAND is set - the address and the command are one decision.
process.env.PG_DUMP_DATABASE_URL ??= "postgres://ams:ams@localhost:5432/ams_test";
process.env.PG_RESTORE_COMMAND ??= `docker exec -i ${container} pg_restore`;

// Backups go to their own bucket, never the attachment one.
process.env.S3_BACKUP_BUCKET ??= "ams-backups-test";
