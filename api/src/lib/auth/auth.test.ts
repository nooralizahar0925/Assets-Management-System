import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

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
