import { z } from "zod";
import type { EmailAddress, EmailProvider } from "../types";
import { smtpProvider } from "./smtp";
import { sendgridProvider } from "./sendgrid";
import { sesProvider } from "./ses";
import { postmarkProvider } from "./postmark";
import { mailgunProvider } from "./mailgun";
import { resendProvider } from "./resend";

export const PROVIDER_TYPES = [
  "smtp", "sendgrid", "ses", "postmark", "mailgun", "resend",
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const CONFIG_SCHEMAS: Record<ProviderType, z.ZodTypeAny> = {
  smtp: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean().default(false),
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  sendgrid: z.object({ api_key: z.string().min(1) }),
  ses: z.object({
    region: z.string().min(1),
    access_key_id: z.string().min(1),
    secret_access_key: z.string().min(1),
  }),
  postmark: z.object({ server_token: z.string().min(1) }),
  mailgun: z.object({
    api_key: z.string().min(1),
    domain: z.string().min(1),
    region: z.enum(["us", "eu"]).default("us"),
  }),
  resend: z.object({ api_key: z.string().min(1) }),
};

/**
 * Which config keys are secrets, and so must be encrypted at rest and masked on
 * read. Adding a provider without listing its secret keys here would store a
 * credential in plaintext, so the two are deliberately side by side.
 */
export const SECRET_KEYS: Record<ProviderType, string[]> = {
  smtp: ["password"],
  sendgrid: ["api_key"],
  ses: ["secret_access_key"],
  postmark: ["server_token"],
  mailgun: ["api_key"],
  resend: ["api_key"],
};

const BUILDERS: Record<
  ProviderType,
  (config: Record<string, unknown>, from: EmailAddress) => EmailProvider
> = {
  smtp: smtpProvider,
  sendgrid: sendgridProvider,
  ses: sesProvider,
  postmark: postmarkProvider,
  mailgun: mailgunProvider,
  resend: resendProvider,
};

export function buildProvider(
  type: ProviderType,
  config: Record<string, unknown>,
  from: EmailAddress,
): EmailProvider {
  const builder = BUILDERS[type];
  if (!builder) throw new Error(`unknown email provider type: ${type}`);
  return builder(config, from);
}
