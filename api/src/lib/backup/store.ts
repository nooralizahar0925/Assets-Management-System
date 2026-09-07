import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
  ListObjectsV2Command, CreateBucketCommand, HeadBucketCommand,
} from "@aws-sdk/client-s3";

/**
 * Where backups live.
 *
 * A separate bucket from attachments on purpose: the two have nothing in
 * common. Attachments are customer content served to browsers; these are
 * database archives that should be readable by almost nobody and expire on
 * their own schedule. Sharing a bucket makes both lifecycle rules and access
 * policies a compromise.
 */
const bucket = process.env.S3_BACKUP_BUCKET ?? "ams-backups";

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "ams",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "ams-secret",
  },
});

let ready: Promise<void> | null = null;

async function ensureBucket(): Promise<void> {
  ready ??= (async () => {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  })();
  return ready;
}

/** `2026-09-07T04-15-00Z.dump` - sortable, and safe in a key. */
export const backupKey = (at: Date = new Date()): string =>
  `${at.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z")}.dump`;

export async function putBackup(key: string, archive: Buffer): Promise<void> {
  await ensureBucket();
  await client.send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: archive,
    ContentType: "application/octet-stream",
  }));
}

export async function getBackup(key: string): Promise<Buffer> {
  await ensureBucket();
  const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await out.Body!.transformToByteArray());
}

export interface BackupEntry {
  key: string;
  size: number;
  modified: Date;
}

export async function listBackups(): Promise<BackupEntry[]> {
  await ensureBucket();
  const out = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
  return (out.Contents ?? [])
    .filter((o) => o.Key?.endsWith(".dump"))
    .map((o) => ({
      key: o.Key!, size: o.Size ?? 0, modified: o.LastModified ?? new Date(0),
    }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

/**
 * Deletes everything past the retention count, newest kept.
 *
 * Counting rather than dating: a system that has been down for a fortnight
 * should still have its last good backup, and an age rule would have thrown it
 * away precisely when it was needed.
 */
export async function pruneBackups(keep: number): Promise<string[]> {
  const all = await listBackups();
  const doomed = all.slice(keep);

  for (const entry of doomed) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: entry.key }));
  }
  return doomed.map((d) => d.key);
}
