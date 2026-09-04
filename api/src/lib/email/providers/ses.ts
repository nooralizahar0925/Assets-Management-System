import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { EmailSendError, type EmailAddress, type EmailMessage, type EmailProvider } from "../types";

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
        const out = await client.send(new SendEmailCommand({
          FromEmailAddress: message.from.name
            ? `${message.from.name} <${message.from.email}>`
            : message.from.email,
          Destination: { ToAddresses: message.to, CcAddresses: message.cc },
          ReplyToAddresses: message.replyTo ? [message.replyTo] : undefined,
          Content: {
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
