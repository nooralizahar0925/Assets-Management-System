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

// MinIO from docker-compose.yml, for the attachment tests. Start it with
// `docker compose up -d minio`.
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_BUCKET ??= "ams-attachments";
process.env.S3_ACCESS_KEY ??= "ams";
process.env.S3_SECRET_KEY ??= "ams-secret";
