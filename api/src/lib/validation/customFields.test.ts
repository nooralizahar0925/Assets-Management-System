import { describe, it, expect } from "vitest";
import { FieldSchemaZ, buildCustomValidator } from "./customFields";

const itSchema = {
  fields: [
    { key: "warranty_end", label: "Warranty End", type: "date", required: false },
    { key: "os", label: "OS", type: "enum", required: true,
      options: ["Windows 11", "macOS"] },
    { key: "ram_gb", label: "RAM (GB)", type: "number", required: false },
  ],
} as const;

describe("FieldSchemaZ", () => {
  it("accepts a well-formed schema", () => {
    expect(FieldSchemaZ.safeParse(itSchema).success).toBe(true);
  });

  it("requires options on an enum field", () => {
    const bad = { fields: [{ key: "os", label: "OS", type: "enum", required: false }] };
    expect(FieldSchemaZ.safeParse(bad).success).toBe(false);
  });

  it("rejects a key that is not a safe identifier", () => {
    const bad = { fields: [{ key: "bad key!", label: "X", type: "string", required: false }] };
    expect(FieldSchemaZ.safeParse(bad).success).toBe(false);
  });

  it("rejects duplicate keys", () => {
    const bad = { fields: [
      { key: "os", label: "A", type: "string", required: false },
      { key: "os", label: "B", type: "string", required: false },
    ] };
    expect(FieldSchemaZ.safeParse(bad).success).toBe(false);
  });
});

describe("buildCustomValidator", () => {
  const validator = buildCustomValidator(itSchema as never);

  it("accepts a valid custom payload", () => {
    expect(validator.safeParse({
      os: "macOS", ram_gb: 16, warranty_end: "2027-01-31",
    }).success).toBe(true);
  });

  it("rejects a missing required field", () => {
    expect(validator.safeParse({ ram_gb: 8 }).success).toBe(false);
  });

  it("rejects a value outside the enum options", () => {
    expect(validator.safeParse({ os: "TempleOS" }).success).toBe(false);
  });

  it("rejects a number field given a non-number", () => {
    expect(validator.safeParse({ os: "macOS", ram_gb: "lots" }).success).toBe(false);
  });

  it("strips fields the schema does not declare", () => {
    expect(validator.parse({ os: "macOS", sneaky: "value" })).not.toHaveProperty("sneaky");
  });

  it("accepts an empty payload when nothing is required", () => {
    const optional = buildCustomValidator({ fields: [
      { key: "note", label: "Note", type: "string", required: false },
    ] });
    expect(optional.safeParse({}).success).toBe(true);
  });
});
