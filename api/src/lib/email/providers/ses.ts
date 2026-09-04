import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import {
  EmailSendError, type EmailAddress, type EmailMessage, type EmailProvider,
} from "../types";

const addressLine = (address: EmailAddress) =>
  address.name ? `${address.name} <${address.email}>` : address.email;

/** Folds a base64 payload to 76-character lines, as RFC 2045 requires. */
const foldBase64 = (data: Buffer) =>
  data.toString("base64").replace(/(.{76})/g, "$1\r\n");

/**
 * Builds a multipart/mixed MIME message.
 *
 * SES's Simple content shape cannot carry attachments, so a scheduled report -
 * the only message in the product that has one - has to be sent as raw MIME.
 * Every other notification goes through the Simple path, which is less code to
 * get wrong.
 */
function buildRawMime(message: EmailMessage): Buffer {
  const boundary = `----ams-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const altBoundary = `${boundary}-alt`;

  const headers = [
    `From: ${addressLine(message.from)}`,
    `To: ${message.to.join(", ")}`,
    ...(message.cc?.length ? [`Cc: ${message.cc.join(", ")}`] : []),
    ...(message.replyTo ? [`Reply-To: ${message.replyTo}`] : []),
    // Encoded per RFC 2047 so a non-ASCII subject survives the transport.
    `Subject: =?UTF-8?B?${Buffer.from(message.subject, "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].join("\r\n");

  const bodyPart = [
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    foldBase64(Buffer.from(message.text, "utf8")),
    "",
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    foldBase64(Buffer.from(message.html, "utf8")),
    "",
    `--${altBoundary}--`,
  ].join("\r\n");

  const attachmentParts = (message.attachments ?? []).map((a) => [
    "",
    `--${boundary}`,
    `Content-Type: ${a.contentType}; name="${a.filename.replace(/"/g, "")}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${a.filename.replace(/"/g, "")}"`,
    "",
    foldBase64(a.content),
  ].join("\r\n")).join("");

  return Buffer.from(
    `${headers}\r\n\r\n${bodyPart}${attachmentParts}\r\n\r\n--${boundary}--\r\n`,
    "utf8",
  );
}

export function sesProvider(
  config: Record<string, unknown>,
  from: EmailAddress,
): EmailProvider {
  const client = new SESv2Client({
    region: String(config.region),
    credentials: {
      accessKeyId: String(config.access_key_id),
      secretAccessKey: String(config.secret_access_key),
    },
  });

  return {
    async send(message: EmailMessage) {
      try {
        const hasAttachments = (message.attachments?.length ?? 0) > 0;

        const out = await client.send(new SendEmailCommand({
          FromEmailAddress: addressLine(message.from),
          Destination: { ToAddresses: message.to, CcAddresses: message.cc },
          ReplyToAddresses: message.replyTo ? [message.replyTo] : undefined,
          Content: hasAttachments
            ? { Raw: { Data: buildRawMime(message) } }
            : {
                Simple: {
                  Subject: { Data: message.subject, Charset: "UTF-8" },
                  Body: {
                    Text: { Data: message.text, Charset: "UTF-8" },
                    Html: { Data: message.html, Charset: "UTF-8" },
                  },
                },
              },
        }));
        return { providerMessageId: out.MessageId ?? "" };
      } catch (err) {
        throw new EmailSendError("ses", null, `SES send failed: ${(err as Error).message}`);
      }
    },
  };
}

/** Exported for testing the MIME construction without reaching AWS. */
export const __buildRawMime = buildRawMime;
