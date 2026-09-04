import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomFields from "./CustomFields";
import type { FieldDef } from "../../api/types";

const schema: FieldDef[] = [
  { key: "os", label: "Operating System", type: "enum", required: true,
    options: ["Windows 11", "macOS"] },
  { key: "ram_gb", label: "RAM (GB)", type: "number", required: false },
  { key: "warranty_end", label: "Warranty End", type: "date", required: false },
  { key: "is_leased", label: "Leased", type: "boolean", required: false },
  { key: "supplier", label: "Supplier", type: "string", required: false },
];

const setup = (over: Partial<React.ComponentProps<typeof CustomFields>> = {}) => {
  const onChange = vi.fn();
  render(
    <CustomFields schema={schema} value={{}} onChange={onChange} errors={{}} {...over} />,
  );
  return { onChange };
};

describe("CustomFields", () => {
  it("renders an input for every field in the schema", () => {
    setup();
    for (const field of schema) {
      // The label is matched literally: "RAM (GB)" through `new RegExp` would
      // treat the parentheses as a capture group and search for "RAM GB".
      expect(
        screen.getByLabelText(field.label, { exact: false }),
      ).toBeInTheDocument();
    }
  });

  it("renders an enum field as a select carrying its options", () => {
    setup();
    const select = screen.getByLabelText(/Operating System/) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect([...select.options].map((o) => o.value)).toContain("macOS");
  });

  it("marks a required field", () => {
    setup();
    expect(screen.getByLabelText(/Operating System/)).toBeRequired();
  });

  it("renders a boolean field as a checkbox", () => {
    setup();
    expect(screen.getByLabelText(/Leased/)).toHaveAttribute("type", "checkbox");
  });

  it("renders a date field as a date input", () => {
    setup();
    expect(screen.getByLabelText(/Warranty End/)).toHaveAttribute("type", "date");
  });

  it("emits a number, not a string, from a number field", async () => {
    // CustomFields is controlled, so a static `value` prop means each keystroke
    // replaces the last and "16" never accumulates. The wrapper holds state the
    // way the real form does.
    const onChange = vi.fn();
    function Stateful() {
      const [value, setValue] = useState<Record<string, unknown>>({});
      return (
        <CustomFields
          schema={schema}
          value={value}
          onChange={(key, next) => {
            onChange(key, next);
            setValue((prev) => ({ ...prev, [key]: next }));
          }}
          errors={{}}
        />
      );
    }
    render(<Stateful />);

    await userEvent.type(screen.getByLabelText("RAM (GB)", { exact: false }), "16");
    expect(onChange).toHaveBeenLastCalledWith("ram_gb", 16);
  });

  it("shows the stored value", () => {
    setup({ value: { supplier: "Acme Supplies" } });
    expect(screen.getByLabelText(/Supplier/)).toHaveValue("Acme Supplies");
  });

  it("shows a server-side error against its field", () => {
    setup({ errors: { os: "is required" } });
    expect(screen.getByText("is required")).toBeInTheDocument();
  });

  it("tells the user when the category defines no extra fields", () => {
    setup({ schema: [] });
    expect(screen.getByText(/no additional fields/i)).toBeInTheDocument();
  });
});
