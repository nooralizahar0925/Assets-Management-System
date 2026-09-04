import { EmailSendError, type EmailAddress, type EmailMessage, type EmailProvider } from "../types";

export function postmarkProvider(
  config: Record<string, unknown>,
  from: EmailAddress,
): EmailProvider {
  const token = String(config.server_token);
  return {
    async send(message: EmailMessage) {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "X-Postmark-Server-Token": token,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          From: message.from.name
            ? `${message.from.name} <${message.from.email}>`
            : message.from.email,
          To: message.to.join(","),
          ...(message.cc?.length ? { Cc: message.cc.join(",") } : {}),
          ...(message.replyTo ? { ReplyTo: message.replyTo } : {}),
          Subject: message.subject,
          HtmlBody: message.html,
          TextBody: message.text,
          MessageStream: "outbound",
          ...(message.attachments?.length
            ? {
                Attachments: message.attachments.map((a) => ({
                  Name: a.filename,
                  Content: a.content.toString("base64"),
                  ContentType: a.contentType,
                })),
              }
            : {}),
        }),
      });

      const body = (await res.json().catch(() => ({}))) as { MessageID?: string; Message?: string };
      if (!res.ok) {
        throw new EmailSendError("postmark", res.status,
          `Postmark rejected the message (${res.status}): ${body.Message ?? ""}`);
      }
      return { providerMessageId: body.MessageID ?? "" };
    },
  };
}
