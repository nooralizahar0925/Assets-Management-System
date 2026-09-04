import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
  CreateBucketCommand, HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const bucket = process.env.S3_BUCKET ?? "ams-attachments";

// forcePathStyle keeps MinIO and real S3 on the same code path, so production
// differs by endpoint and credentials only.
export const s3 = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "",
  },
});

let bucketReady: Promise<void> | null = null;

/** Creates the bucket on first use so a fresh environment needs no manual setup. */
function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  })();
  return bucketReady;
}

export async function putObject(
  key: string, body: Buffer, contentType: string,
): Promise<void> {
  await ensureBucket();
  await s3.send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: body, ContentType: contentType,
  }));
}

export async function getObject(key: string): Promise<Buffer> {
  await ensureBucket();
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await out.Body!.transformToByteArray());
}

export async function deleteObject(key: string): Promise<void> {
  await ensureBucket();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function presignGet(key: string, seconds = 300): Promise<string> {
  await ensureBucket();
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: seconds,
  });
}
