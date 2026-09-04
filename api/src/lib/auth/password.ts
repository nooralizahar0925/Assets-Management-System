import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  pw: string, salt: Buffer, len: number,
) => Promise<Buffer>;

const KEYLEN = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(plain, salt, KEYLEN);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !keyB64) return false;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(keyB64, "base64url");
  const actual = await scryptAsync(plain, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
