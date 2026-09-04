import nodemailer from "nodemailer";
import { EmailSendError, type EmailAddress, type EmailMessage, type EmailProvider } from "../types";

export function smtpProvider(
  config: Record<string, unknown>,
  from: EmailAddress,
): EmailProvider {
  const transport = nodemailer.createTransport({
    host: String(config.host),
    port: Number(config.port),
    secure: Boolean(config.secure),
    auth: { user: String(config.username), pass: String(config.password) },
  });

  return {
    async send(message: EmailMessage) {
      try {
        const info = await transport.sendMail({
          from: { address: message.from.email, name: message.from.name ?? "" },
          to: message.to,
          cc: message.cc,
          replyTo: message.replyTo,
          subject: message.subject,
          text: message.text,
          html: message.html,
          attachments: message.attachments?.map((a) => ({
            filename: a.filename, content: a.content, contentType: a.contentType,
          })),
        });
        return { providerMessageId: info.messageId };
      } catch (err) {
        throw new EmailSendError("smtp", null, `SMTP send failed: ${(err as Error).message}`);
      }
    },
  };
}
