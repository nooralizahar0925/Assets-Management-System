import { api } from "./client";

export type ProviderType =
  | "smtp" | "sendgrid" | "ses" | "postmark" | "mailgun" | "resend";

export interface EmailProvider {
  id: string;
  name: string;
  type: ProviderType;
  from_email: string;
  from_name: string | null;
  reply_to: string | null;
  priority: number;
  active: boolean;
  config: Record<string, unknown>;
  verified_at: string | null;
  last_error: string | null;
}

export interface EmailTemplate {
  key: string;
  customised: boolean;
  subject: string;
  html_body: string;
  text_body: string;
}

export interface EmailMessage {
  id: string;
  to_addresses: string[];
  subject: string;
  status: string;
  attempts: number;
  last_error: string | null;
  provider_name: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface NotificationRule {
  id: string;
  event: string;
  channel: "email" | "webhook";
  template_key: string;
  recipient_spec: {
    roles?: string[]; user_ids?: string[]; emails?: string[];
    assignee?: boolean; actor?: boolean;
  };
  active: boolean;
}

export const settingsApi = {
  providers: () => api.get<EmailProvider[]>("/api/admin/email/providers"),
  createProvider: (input: Partial<EmailProvider>) =>
    api.post<EmailProvider>("/api/admin/email/providers", input),
  updateProvider: (id: string, patch: Partial<EmailProvider>) =>
    api.patch<EmailProvider>(`/api/admin/email/providers/${id}`, patch),
  deleteProvider: (id: string) => api.del(`/api/admin/email/providers/${id}`),
  testProvider: (id: string, to: string) =>
    api.post<{ ok: boolean; error?: string }>(
      `/api/admin/email/providers/${id}/test`, { to },
    ),

  templates: () => api.get<EmailTemplate[]>("/api/admin/email/templates"),
  saveTemplate: (template: Omit<EmailTemplate, "customised">) =>
    api.put("/api/admin/email/templates", template),

  messages: (limit = 100) =>
    api.get<EmailMessage[]>("/api/admin/email/messages", { limit }),

  rules: () =>
    api.get<NotificationRule[]>("/api/admin/notifications/rules"),
  saveRule: (input: Partial<NotificationRule>) =>
    api.post<NotificationRule>("/api/admin/notifications/rules", input),
  updateRule: (id: string, patch: Partial<NotificationRule>) =>
    api.patch<NotificationRule>(`/api/admin/notifications/rules/${id}`, patch),
  deleteRule: (id: string) => api.del(`/api/admin/notifications/rules/${id}`),

  preferences: () =>
    api.get<{ event: string; email_enabled: boolean }[]>(
      "/api/admin/notifications/preferences",
    ),
  savePreferences: (preferences: { event: string; email_enabled: boolean }[]) =>
    api.put("/api/admin/notifications/preferences", { preferences }),
};

export interface ProviderField {
  key: string;
  label: string;
  type: "text" | "number" | "password" | "checkbox" | "select";
  options?: string[];
  secret?: boolean;
}

/** Mirrors CONFIG_SCHEMAS in api/src/lib/email/providers/index.ts. */
export const PROVIDER_FIELDS: Record<ProviderType, ProviderField[]> = {
  smtp: [
    { key: "host", label: "Host", type: "text" },
    { key: "port", label: "Port", type: "number" },
    { key: "secure", label: "Use TLS on connect (port 465)", type: "checkbox" },
    { key: "username", label: "Username", type: "text" },
    { key: "password", label: "Password", type: "password", secret: true },
  ],
  sendgrid: [{ key: "api_key", label: "API key", type: "password", secret: true }],
  ses: [
    { key: "region", label: "Region", type: "text" },
    { key: "access_key_id", label: "Access key ID", type: "text" },
    { key: "secret_access_key", label: "Secret access key", type: "password", secret: true },
  ],
  postmark: [
    { key: "server_token", label: "Server token", type: "password", secret: true },
  ],
  mailgun: [
    { key: "api_key", label: "API key", type: "password", secret: true },
    { key: "domain", label: "Domain", type: "text" },
    { key: "region", label: "Region", type: "select", options: ["us", "eu"] },
  ],
  resend: [{ key: "api_key", label: "API key", type: "password", secret: true }],
};

export const PROVIDER_LABELS: Record<ProviderType, string> = {
  smtp: "SMTP",
  sendgrid: "SendGrid",
  ses: "Amazon SES",
  postmark: "Postmark",
  mailgun: "Mailgun",
  resend: "Resend",
};
