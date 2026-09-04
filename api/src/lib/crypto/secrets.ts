import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function key(): Buffer {
  const hex = process.env.APP_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "APP_ENCRYPTION_KEY must be 64 hex characters (32 bytes). " +
      "Generate one with: openssl rand -hex 32",
    );
  }
  return Buffer.from(hex, "hex");
}

/** AES-256-GCM. The auth tag makes tampering a decryption failure, not silent corruption. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(sealed: string): string {
  const [version, ivB64, tagB64, dataB64] = sealed.split(".");
  if (version !== VERSION) throw new Error(`unsupported secret format: ${version}`);
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** `sk_live_9f2b7c4a` → `sk_live_••••7c4a`. Enough to recognise, useless to steal. */
export function maskSecret(plain: string): string {
  if (plain.length < 8) return "••••";
  const tail = plain.slice(-4);
  const prefixMatch = plain.match(/^([A-Za-z]+[_.])+/);
  const prefix = prefixMatch ? prefixMatch[0] : "";
  return `${prefix}••••${tail}`;
}

type Config = Record<string, unknown>;

export function sealConfig(config: Config, secretKeys: string[]): Config {
  const out: Config = { ...config };
  for (const k of secretKeys) {
    if (typeof out[k] === "string" && out[k]) out[k] = encryptSecret(out[k] as string);
  }
  return out;
}

export function openConfig(config: Config, secretKeys: string[]): Config {
  const out: Config = { ...config };
  for (const k of secretKeys) {
    if (typeof out[k] === "string" && out[k]) out[k] = decryptSecret(out[k] as string);
  }
  return out;
}

export function maskConfig(config: Config, secretKeys: string[]): Config {
  const out: Config = { ...config };
  for (const k of secretKeys) {
    if (typeof out[k] === "string" && out[k]) {
      out[k] = maskSecret(decryptSecret(out[k] as string));
    }
  }
  return out;
}
