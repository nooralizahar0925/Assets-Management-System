import { withTenant } from "../db";
import type { Ctx } from "../http/handler";

export interface Template {
  subject: string;
  html_body: string;
  text_body: string;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]!);

function resolve(vars: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (acc, key) =>
      acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
    vars,
  );
}

function applyFilter(value: unknown, filter: string, vars: Record<string, unknown>): string {
  if (value === null || value === undefined) return "";
  switch (filter) {
    case "date":
      return new Date(String(value)).toLocaleDateString("en-GB", {
        day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
      });
    case "datetime":
      return new Date(String(value)).toLocaleString("en-GB", {
        day: "numeric", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", timeZone: "UTC",
      });
    case "money": {
      const currency =
        String((resolve(vars, "asset.currency") ?? resolve(vars, "currency")) || "IDR");
      return new Intl.NumberFormat("id-ID", {
        style: "currency", currency, maximumFractionDigits: 0,
      }).format(Number(value));
    }
    default:
      return String(value);
  }
}

const TOKEN = /\{\{\s*([a-z0-9_.]+)\s*(?:\|\s*([a-z]+)\s*)?\}\}/gi;

function fill(
  template: string,
  vars: Record<string, unknown>,
  escape: boolean,
): string {
  return template.replace(TOKEN, (_match, path: string, filter?: string) => {
    const raw = resolve(vars, path);
    const value = filter ? applyFilter(raw, filter, vars) : String(raw ?? "");
    return escape ? escapeHtml(value) : value;
  });
}

/**
 * Substitution only — no expressions, no loops, no code execution. A template is
 * editable by an org admin, so it must not be a scripting surface.
 */
export function render(
  template: Template,
  vars: Record<string, unknown>,
): { subject: string; html: string; text: string } {
  return {
    subject: fill(template.subject, vars, false),
    html: fill(template.html_body, vars, true),
    text: fill(template.text_body, vars, false),
  };
}

const layout = (body: string) => `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;
            max-width:560px;margin:0 auto;padding:24px;color:#1f2937">
  ${body}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="font-size:12px;color:#6b7280">
    Sent by {{org.name}} Asset Management.
  </p>
</div>`.trim();

export const SEED_TEMPLATES: Record<string, Template> = {
  "asset.checked_out": {
    subject: "{{asset.name}} has been assigned to you",
    html_body: layout(`
      <h2 style="margin:0 0 16px">Asset assigned</h2>
      <p>Hi {{recipient.name}}, <strong>{{asset.name}}</strong>
         ({{asset.asset_tag}}) is now assigned to you.</p>
      <p>Due back: <strong>{{assignment.due_at | date}}</strong></p>
      <p><a href="{{links.asset}}">View the asset</a></p>`),
    text_body:
      "Hi {{recipient.name}}, {{asset.name}} ({{asset.asset_tag}}) is now assigned to you.\n" +
      "Due back: {{assignment.due_at | date}}\n{{links.asset}}",
  },
  "asset.checked_in": {
    subject: "{{asset.name}} has been returned",
    html_body: layout(`
      <h2 style="margin:0 0 16px">Asset returned</h2>
      <p><strong>{{asset.name}}</strong> ({{asset.asset_tag}}) was checked in by
         {{actor.name}} on {{assignment.checked_in_at | datetime}}.</p>
      <p>Condition: {{assignment.condition}}</p>`),
    text_body:
      "{{asset.name}} ({{asset.asset_tag}}) was checked in by {{actor.name}} " +
      "on {{assignment.checked_in_at | datetime}}. Condition: {{assignment.condition}}",
  },
  "asset.overdue": {
    subject: "Overdue: {{asset.name}} was due {{assignment.due_at | date}}",
    html_body: layout(`
      <h2 style="margin:0 0 16px;color:#b91c1c">Asset overdue</h2>
      <p><strong>{{asset.name}}</strong> ({{asset.asset_tag}}) was due back on
         {{assignment.due_at | date}} and has not been returned.</p>
      <p><a href="{{links.asset}}">Check it in</a></p>`),
    text_body:
      "{{asset.name}} ({{asset.asset_tag}}) was due back on " +
      "{{assignment.due_at | date}} and has not been returned. {{links.asset}}",
  },
  "warranty.expiring": {
    subject: "Warranty expiring: {{asset.name}}",
    html_body: layout(`
      <h2 style="margin:0 0 16px">Warranty expiring</h2>
      <p>The warranty on <strong>{{asset.name}}</strong> ({{asset.asset_tag}})
         expires on {{asset.custom.warranty_end | date}}.</p>`),
    text_body:
      "The warranty on {{asset.name}} ({{asset.asset_tag}}) expires on " +
      "{{asset.custom.warranty_end | date}}.",
  },
  "licence.expiring": {
    subject: "Licence expiring: {{asset.name}}",
    html_body: layout(`
      <h2 style="margin:0 0 16px">Licence expiring</h2>
      <p>The licence for <strong>{{asset.name}}</strong> expires on
         {{asset.custom.license_expiry | date}}.</p>
      <p>Rights holder: {{asset.custom.rights_holder}}</p>`),
    text_body:
      "The licence for {{asset.name}} expires on {{asset.custom.license_expiry | date}}. " +
      "Rights holder: {{asset.custom.rights_holder}}",
  },
  "maintenance.due": {
    subject: "Service due: {{asset.name}}",
    html_body: layout(`
      <h2 style="margin:0 0 16px">Maintenance due</h2>
      <p><strong>{{asset.name}}</strong> ({{asset.asset_tag}}) is due for service on
         {{asset.custom.next_service_at | date}}.</p>
      <p>Hours run: {{asset.custom.hours_run}}</p>`),
    text_body:
      "{{asset.name}} ({{asset.asset_tag}}) is due for service on " +
      "{{asset.custom.next_service_at | date}}. Hours run: {{asset.custom.hours_run}}",
  },
  "import.completed": {
    subject: "Import finished: {{import.filename}}",
    html_body: layout(`
      <h2 style="margin:0 0 16px">Import finished</h2>
      <p>{{import.filename}} processed {{import.total}} rows:
         {{import.created}} created, {{import.updated}} updated,
         {{import.skipped}} skipped.</p>
      <p><a href="{{links.import}}">View the result</a></p>`),
    text_body:
      "{{import.filename}} processed {{import.total}} rows: {{import.created}} created, " +
      "{{import.updated}} updated, {{import.skipped}} skipped. {{links.import}}",
  },
  "report.scheduled": {
    subject: "{{report.name}} — {{report.generated_at | date}}",
    html_body: layout(`
      <h2 style="margin:0 0 16px">{{report.name}}</h2>
      <p>Your scheduled report is attached as {{report.format}}.</p>
      <p>Covering: {{report.period}}</p>
      <p><a href="{{links.report}}">Open it in the dashboard</a></p>`),
    text_body:
      "{{report.name}} is attached as {{report.format}}. Covering: {{report.period}}. " +
      "{{links.report}}",
  },
  "user.invite": {
    subject: "You have been invited to {{org.name}} Asset Management",
    html_body: layout(`
      <h2 style="margin:0 0 16px">Welcome</h2>
      <p>{{actor.name}} has invited you to {{org.name}} Asset Management
         as a {{recipient.role}}.</p>
      <p><a href="{{links.invite}}">Set your password</a></p>
      <p style="font-size:12px;color:#6b7280">This link expires in 72 hours.</p>`),
    text_body:
      "{{actor.name}} has invited you to {{org.name}} Asset Management as a " +
      "{{recipient.role}}. Set your password: {{links.invite}} (expires in 72 hours)",
  },
  "password.reset": {
    subject: "Reset your password",
    html_body: layout(`
      <h2 style="margin:0 0 16px">Password reset</h2>
      <p>Use the link below to choose a new password.</p>
      <p><a href="{{links.reset}}">Reset password</a></p>
      <p style="font-size:12px;color:#6b7280">
        This link expires in 1 hour. If you did not request it, ignore this email.</p>`),
    text_body:
      "Use this link to choose a new password: {{links.reset}} " +
      "(expires in 1 hour). If you did not request it, ignore this email.",
  },
  "product.release": {
    subject: "What's new in {{release.version}}",
    html_body: layout(`
      <h2 style="margin:0 0 16px">{{release.title}}</h2>
      <p>Version {{release.version}} is live.</p>
      <p>{{release.summary}}</p>
      <p><a href="{{links.whats_new}}">See everything that changed</a></p>`),
    text_body:
      "{{release.title}} — version {{release.version}} is live. {{release.summary}} " +
      "{{links.whats_new}}",
  },
};

/** An org's override if it has one, otherwise the shipped default. */
export async function getTemplate(ctx: Ctx, key: string): Promise<Template> {
  const override = await withTenant(ctx.orgId, async (c) =>
    (await c.query<Template>(
      "SELECT subject, html_body, text_body FROM email_templates WHERE key = $1", [key],
    )).rows[0],
  );
  const seed = SEED_TEMPLATES[key];
  if (!override && !seed) throw new Error(`unknown email template: ${key}`);
  return override ?? seed;
}

export const listTemplates = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) => {
    const overrides = new Map(
      (await c.query<{ key: string } & Template>(
        "SELECT key, subject, html_body, text_body FROM email_templates",
      )).rows.map((r) => [r.key, r]),
    );
    return Object.entries(SEED_TEMPLATES).map(([key, seed]) => ({
      key,
      customised: overrides.has(key),
      ...(overrides.get(key) ?? seed),
    }));
  });

export const upsertTemplate = (ctx: Ctx, key: string, template: Template) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Template>(
      `INSERT INTO email_templates (org_id, key, subject, html_body, text_body)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (org_id, key) DO UPDATE SET
         subject = excluded.subject,
         html_body = excluded.html_body,
         text_body = excluded.text_body,
         updated_at = now()
       RETURNING subject, html_body, text_body`,
      [ctx.orgId, key, template.subject, template.html_body, template.text_body],
    )).rows[0],
  );
