import { EmailSendError, type EmailAddress, type EmailMessage, type EmailProvider } from "../types";

export function mailgunProvider(
  config: Record<string, unknown>,
  from: EmailAddress,
): EmailProvider {
  const apiKey = String(config.api_key);
  const domain = String(config.domain);
  const host = config.region === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";

  return {
    async send(message: EmailMessage) {
      const form = new FormData();
      form.set("from", message.from.name
        ? `${message.from.name} <${message.from.email}>`
        : message.from.email);
      for (const to of message.to) form.append("to", to);
      for (const cc of message.cc ?? []) form.append("cc", cc);
      if (message.replyTo) form.set("h:Reply-To", message.replyTo);
      form.set("subject", message.subject);
      form.set("text", message.text);
      form.set("html", message.html);
      for (const a of message.attachments ?? []) {
        form.append("attachment", new Blob([a.content], { type: a.contentType }), a.filename);
      }

      const res = await fetch(`https://${host}/v3/${domain}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
        },
        body: form,
      });

      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) {
        throw new EmailSendError("mailgun", res.status,
          `Mailgun rejected the message (${res.status}): ${body.message ?? ""}`);
      }
      return { providerMessageId: body.id ?? "" };
    },
  };
}
