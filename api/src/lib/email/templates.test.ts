import { describe, it, expect } from "vitest";
import { render, SEED_TEMPLATES } from "./templates";

describe("render", () => {
  const template = {
    subject: "{{asset.name}} is due back {{assignment.due_at | date}}",
    html_body: "<p>Hi {{user.name}}, please return {{asset.name}}.</p>",
    text_body: "Hi {{user.name}}, please return {{asset.name}}.",
  };
  const vars = {
    asset: { name: "Dell Latitude" },
    user: { name: "Rina" },
    assignment: { due_at: "2026-10-14T09:00:00Z" },
  };

  it("substitutes nested variables", () => {
    const out = render(template, vars);
    expect(out.text).toBe("Hi Rina, please return Dell Latitude.");
  });

  it("applies the date filter", () => {
    expect(render(template, vars).subject).toBe("Dell Latitude is due back 14 Oct 2026");
  });

  it("renders a missing variable as an empty string, never as the raw token", () => {
    const out = render({ ...template, text_body: "Hello {{nobody.here}}!" }, vars);
    expect(out.text).toBe("Hello !");
  });

  it("escapes HTML in a variable so asset names cannot inject markup", () => {
    const out = render(
      { subject: "s", html_body: "<p>{{asset.name}}</p>", text_body: "{{asset.name}}" },
      { asset: { name: '<img src=x onerror="alert(1)">' } },
    );
    expect(out.html).toContain("&lt;img");
    expect(out.html).not.toContain("<img");
  });

  it("formats money with its currency", () => {
    const out = render(
      { subject: "s", html_body: "h", text_body: "{{asset.purchase_cost | money}}" },
      { asset: { purchase_cost: 1250000, currency: "IDR" } },
    );
    expect(out.text).toMatch(/1.250.000|1,250,000/);
  });
});

describe("SEED_TEMPLATES", () => {
  it("ships every template the notification rules reference", () => {
    expect(Object.keys(SEED_TEMPLATES).sort()).toEqual([
      "asset.checked_in", "asset.checked_out", "asset.overdue",
      "import.completed", "licence.expiring", "maintenance.due",
      "password.reset", "product.release", "report.scheduled",
      "user.invite", "warranty.expiring",
    ].sort());
  });

  it("gives every template a subject, an HTML body and a text body", () => {
    for (const [key, t] of Object.entries(SEED_TEMPLATES)) {
      expect(t.subject, key).toBeTruthy();
      expect(t.html_body, key).toBeTruthy();
      expect(t.text_body, key).toBeTruthy();
    }
  });
});
