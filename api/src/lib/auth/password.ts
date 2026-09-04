import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

const scryptAsync = promisify(scrypt) as (
  pw: string,
  salt: Buffer,
  len: number,
  opts: ScryptParams & { maxmem: number },
) => Promise<Buffer>;

const KEYLEN = 64;

/**
 * OWASP's floor for scrypt is N=2^17, r=8, p=1. Node's own default is N=2^14,
 * which is four times cheaper to attack.
 */
const CURRENT: ScryptParams = { N: 131_072, r: 8, p: 1 };

/**
 * scrypt needs roughly 128 * N * r bytes: 128 MiB at the parameters above,
 * comfortably over Node's 32 MiB default, which would otherwise reject them.
 */
const maxmemFor = ({ N, r }: ScryptParams) => Math.max(32, 128 * N * r * 1.5);

const derive = (plain: string, salt: Buffer, len: number, params: ScryptParams) =>
  scryptAsync(plain, salt, len, { ...params, maxmem: maxmemFor(params) });

/**
 * Encodes as `scrypt$N$r$p$salt$key`.
 *
 * The cost parameters are stored with the hash rather than assumed, so raising
 * them later is a change to CURRENT plus a re-hash on next successful login -
 * not a forced password reset for every user, which is what an unparameterised
 * format eventually costs.
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(plain, salt, KEYLEN, CURRENT);
  const { N, r, p } = CURRENT;
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

interface ParsedHash {
  params: ScryptParams;
  salt: Buffer;
  expected: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts[0] !== "scrypt") return null;

  // scrypt$N$r$p$salt$key
  if (parts.length === 6) {
    const [, rawN, rawR, rawP, saltB64, keyB64] = parts;
    const N = Number(rawN);
    const r = Number(rawR);
    const p = Number(rawP);
    if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return null;
    if (!saltB64 || !keyB64) return null;
    return {
      params: { N, r, p },
      salt: Buffer.from(saltB64, "base64url"),
      expected: Buffer.from(keyB64, "base64url"),
    };
  }

  // Legacy scrypt$salt$key, written before the parameters were recorded. Node's
  // defaults applied then, so that is what verifies them now.
  if (parts.length === 3) {
    const [, saltB64, keyB64] = parts;
    if (!saltB64 || !keyB64) return null;
    return {
      params: { N: 16_384, r: 8, p: 1 },
      salt: Buffer.from(saltB64, "base64url"),
      expected: Buffer.from(keyB64, "base64url"),
    };
  }

  return null;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;

  const { params, salt, expected } = parsed;
  if (expected.length === 0) return false;

  const actual = await derive(plain, salt, expected.length, params);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * True when `stored` was written with weaker parameters than CURRENT, so the
 * caller can transparently re-hash on a successful login.
 */
export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return true;
  const { N, r, p } = parsed.params;
  return N < CURRENT.N || r < CURRENT.r || p < CURRENT.p;
}

/**
 * A hash of a value nobody can supply, used to spend the same time on a login
 * for an address that does not exist as on one that does. Computed once at
 * module load with the current parameters.
 */
export const DUMMY_HASH_PROMISE = hashPassword(randomBytes(32).toString("hex"));
