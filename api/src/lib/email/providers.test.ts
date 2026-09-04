import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildProvider, CONFIG_SCHEMAS, SECRET_KEYS } from "./providers";

const from = { email: "ams@example.com", name: "AMS" };
const message = {
  to: ["rina@example.com"],
  subject: "Asset assigned",
  html: "<p>Hello</p>",
  text: "Hello",
  from,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("config schemas", () => {
  it("requires an api key for sendgrid", () => {
    expect(CONFIG_SCHEMAS.sendgrid.safeParse({}).success).toBe(false);
    expect(CONFIG_SCHEMAS.sendgrid.safeParse({ api_key: "SG.x" }).success).toBe(true);
  });

  it("requires host and port for smtp", () => {
    expect(CONFIG_SCHEMAS.smtp.safeParse({ host: "smtp.x.com" }).success).toBe(false);
    expect(CONFIG_SCHEMAS.smtp.safeParse({
      host: "smtp.x.com", port: 587, secure: false,
      username: "u", password: "p",
    }).success).toBe(true);
  });

  it("declares which keys hold secrets for every provider type", () => {
    expect(SECRET_KEYS.sendgrid).toEqual(["api_key"]);
    expect(SECRET_KEYS.smtp).toEqual(["password"]);
    expect(SECRET_KEYS.ses).toEqual(["secret_access_key"]);
  });
});

describe("buildProvider", () => {
  it("posts to the SendGrid API and returns the message id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 202, headers: { "x-message-id": "sg-1" } }),
    );
    const provider = buildProvider("sendgrid", { api_key: "SG.test" }, from);
    await expect(provider.send(message)).resolves.toEqual({ providerMessageId: "sg-1" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer SG.test");
  });

  it("throws a descriptive error when the provider rejects the send", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: "bad key" }] }), { status: 401 }),
    );
    const provider = buildProvider("sendgrid", { api_key: "SG.bad" }, from);
    await expect(provider.send(message)).rejects.toThrow(/401/);
  });

  it("posts form-encoded to Mailgun with basic auth", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "<mg-1>" }), { status: 200 }),
    );
    const provider = buildProvider(
      "mailgun", { api_key: "key-x", domain: "mg.example.com", region: "us" }, from,
    );
    await expect(provider.send(message)).resolves.toEqual({ providerMessageId: "<mg-1>" });
    expect(fetchMock.mock.calls[0][0]).toContain("mg.example.com/messages");
  });

  it("posts to Postmark with the server token header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ MessageID: "pm-1" }), { status: 200 }),
    );
    const provider = buildProvider("postmark", { server_token: "tok" }, from);
    await expect(provider.send(message)).resolves.toEqual({ providerMessageId: "pm-1" });
    expect(
      (fetchMock.mock.calls[0][1]!.headers as Record<string, string>)["X-Postmark-Server-Token"],
    ).toBe("tok");
  });

  it("posts to Resend with a bearer token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "re-1" }), { status: 200 }),
    );
    const provider = buildProvider("resend", { api_key: "re_x" }, from);
    await expect(provider.send(message)).resolves.toEqual({ providerMessageId: "re-1" });
  });

  it("refuses an unknown provider type", () => {
    expect(() => buildProvider("carrier-pigeon" as never, {}, from)).toThrow(/unknown/i);
  });
});
