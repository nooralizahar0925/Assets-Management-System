import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, needsRehash } from "./password";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash))
      .resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("s3cret");
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });

  it("produces a different hash each time (salted)", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
});

describe("hash format and cost", () => {
  it("records the cost parameters in the hash", async () => {
    const hash = await hashPassword("x");
    expect(hash).toMatch(/^scrypt\$131072\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  });

  it("still verifies a legacy hash written without parameters", async () => {
    // scrypt$salt$key at Node's old defaults — the format shipped before the
    // cost parameters were recorded. It must keep verifying, or every existing
    // user is locked out by the upgrade.
    const { scrypt: rawScrypt, randomBytes } = await import("node:crypto");
    const { promisify } = await import("node:util");
    const legacyDerive = promisify(rawScrypt) as (
      pw: string, salt: Buffer, len: number,
    ) => Promise<Buffer>;

    const salt = randomBytes(16);
    const key = await legacyDerive("hunter2", salt, 64);
    const legacy = `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;

    await expect(verifyPassword("hunter2", legacy)).resolves.toBe(true);
    await expect(verifyPassword("wrong", legacy)).resolves.toBe(false);
  });

  it("flags a legacy hash for rehashing but not a current one", async () => {
    expect(needsRehash("scrypt$c2FsdA$a2V5")).toBe(true);
    expect(needsRehash(await hashPassword("x"))).toBe(false);
  });

  it("rejects a malformed hash rather than throwing", async () => {
    for (const bad of ["", "notahash", "bcrypt$a$b", "scrypt$a", "scrypt$x$y$z$s$k"]) {
      await expect(verifyPassword("x", bad)).resolves.toBe(false);
    }
  });
});
