import { EmailSendError, type EmailAddress, type EmailMessage, type EmailProvider } from "../types";

export function sendgridProvider(
  config: Record<string, unknown>,
  from: EmailAddress,
): EmailProvider {
  const apiKey = String(config.api_key);
  return {
    async send(message: EmailMessage) {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{
            to: message.to.map((email) => ({ email })),
            ...(message.cc?.length ? { cc: message.cc.map((email) => ({ email })) } : {}),
          }],
          from: { email: message.from.email, name: message.from.name },
          ...(message.replyTo ? { reply_to: { email: message.replyTo } } : {}),
          subject: message.subject,
          content: [
            { type: "text/plain", value: message.text },
            { type: "text/html", value: message.html },
          ],
          ...(message.attachments?.length
            ? {
                attachments: message.attachments.map((a) => ({
                  filename: a.filename,
                  type: a.contentType,
                  content: a.content.toString("base64"),
                })),
              }
            : {}),
        }),
      });

      if (!res.ok) {
        throw new EmailSendError("sendgrid", res.status,
          `SendGrid rejected the message (${res.status}): ${await res.text()}`);
      }
      return { providerMessageId: res.headers.get("x-message-id") ?? "" };
    },
  };
}
