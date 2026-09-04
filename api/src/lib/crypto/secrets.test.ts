import { describe, it, expect } from "vitest";
import {
  encryptSecret, decryptSecret, maskSecret, sealConfig, openConfig, maskConfig,
} from "./secrets";

describe("encryptSecret", () => {
  it("round-trips a value", () => {
    expect(decryptSecret(encryptSecret("SG.abc123"))).toBe("SG.abc123");
  });

  it("produces different ciphertext each time (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("never contains the plaintext", () => {
    expect(encryptSecret("supersecret")).not.toContain("supersecret");
  });

  it("rejects tampered ciphertext rather than returning garbage", () => {
    const sealed = encryptSecret("value");
    const tampered = sealed.slice(0, -4) + "AAAA";
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe("maskSecret", () => {
  it("keeps a recognisable prefix and the last four characters", () => {
    expect(maskSecret("sk_live_9f2b7c4a")).toBe("sk_live_••••7c4a");
  });

  it("fully masks a short secret", () => {
    expect(maskSecret("abc")).toBe("••••");
  });
});

describe("config sealing", () => {
  const config = { host: "smtp.example.com", port: 587, password: "hunter2" };

  it("encrypts only the declared secret keys", () => {
    const sealed = sealConfig(config, ["password"]);
    expect(sealed.host).toBe("smtp.example.com");
    expect(sealed.password).not.toBe("hunter2");
  });

  it("opens back to the original values", () => {
    expect(openConfig(sealConfig(config, ["password"]), ["password"])).toEqual(config);
  });

  it("masks secrets for API responses", () => {
    const masked = maskConfig(sealConfig(config, ["password"]), ["password"]);
    expect(masked.password).toMatch(/•/);
    expect(masked.host).toBe("smtp.example.com");
  });
});
