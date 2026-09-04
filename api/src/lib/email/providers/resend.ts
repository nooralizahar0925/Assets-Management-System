import { EmailSendError, type EmailAddress, type EmailMessage, type EmailProvider } from "../types";

export function resendProvider(
  config: Record<string, unknown>,
  from: EmailAddress,
): EmailProvider {
  const apiKey = String(config.api_key);
  return {
    async send(message: EmailMessage) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: message.from.name
            ? `${message.from.name} <${message.from.email}>`
            : message.from.email,
          to: message.to,
          ...(message.cc?.length ? { cc: message.cc } : {}),
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.attachments?.length
            ? {
                attachments: message.attachments.map((a) => ({
                  filename: a.filename,
                  content: a.content.toString("base64"),
                })),
              }
            : {}),
        }),
      });

      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) {
        throw new EmailSendError("resend", res.status,
          `Resend rejected the message (${res.status}): ${body.message ?? ""}`);
      }
      return { providerMessageId: body.id ?? "" };
    },
  };
}
