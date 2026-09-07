import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FieldSchemaEditor from "./FieldSchemaEditor";
import type { FieldDef } from "../../api/types";

const fields: FieldDef[] = [
  { key: "os", label: "Operating System", type: "string", required: false },
  { key: "ram_gb", label: "RAM", type: "number", required: true },
];

/**
 * The editor is controlled: it renders whatever `fields` it is handed. Rendering
 * it with a fixed prop means typing never accumulates - each keystroke is
 * reverted on re-render, and the spy sees only the last character. This harness
 * feeds its output back the way the real page does.
 */
function Harness({
  initial, onChange,
}: { initial: FieldDef[]; onChange: (fields: FieldDef[]) => void }) {
  const [current, setCurrent] = useState(initial);
  return (
    <FieldSchemaEditor
      fields={current}
      onChange={(next) => { setCurrent(next); onChange(next); }}
    />
  );
}

/** The app targets ES2020, where Array.prototype.at does not exist. */
const lastFields = (spy: ReturnType<typeof vi.fn>): FieldDef[] =>
  spy.mock.calls[spy.mock.calls.length - 1][0];

const setup = (over: { fields?: FieldDef[] } = {}) => {
  const onChange = vi.fn();
  render(<Harness initial={over.fields ?? fields} onChange={onChange} />);
  return { onChange };
};

describe("FieldSchemaEditor", () => {
  it("lists the existing fields", () => {
    setup();
    expect(screen.getByDisplayValue("Operating System")).toBeInTheDocument();
    expect(screen.getByDisplayValue("RAM")).toBeInTheDocument();
  });

  it("adds a field", async () => {
    const { onChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: /Add field/i }));
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: expect.any(String) }),
    ]));
    expect(onChange.mock.calls[0][0]).toHaveLength(3);
  });

  it("removes a field", async () => {
    const { onChange } = setup();
    await userEvent.click(screen.getAllByRole("button", { name: /Remove/i })[0]);
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
  });

  it("derives a snake_case key from the label", async () => {
    const { onChange } = setup({ fields: [
      { key: "", label: "", type: "string", required: false },
    ] });
    await userEvent.type(screen.getByLabelText(/Label/), "Cost Centre");
    expect(lastFields(onChange)[0].key).toBe("cost_centre");
  });

  it("leaves a stored key alone when its label is edited", async () => {
    // Renaming "Operating System" to "Operating system (OS)" must not repoint
    // the field at a new key - every asset already filed under "os" would lose
    // its value.
    const { onChange } = setup({ fields: [fields[0]] });
    await userEvent.type(screen.getByLabelText(/Label/), " v2");
    expect(lastFields(onChange)[0].key).toBe("os");
    expect(lastFields(onChange)[0].label).toBe("Operating System v2");
  });

  it("reveals an options input when the type is enum", async () => {
    setup({ fields: [{ key: "os", label: "OS", type: "enum", required: false, options: ["A"] }] });
    expect(screen.getByLabelText(/Options/)).toBeInTheDocument();
  });

  it("splits comma-separated options into a list", async () => {
    const { onChange } = setup({ fields: [
      { key: "os", label: "OS", type: "enum", required: false, options: [] },
    ] });
    await userEvent.type(screen.getByLabelText(/Options/), "Windows, macOS");
    expect(lastFields(onChange)[0].options).toEqual(["Windows", "macOS"]);
  });

  it("warns about a duplicate key", () => {
    setup({ fields: [
      { key: "os", label: "A", type: "string", required: false },
      { key: "os", label: "B", type: "string", required: false },
    ] });
    expect(screen.getByRole("alert")).toHaveTextContent(/unique/i);
  });

  it("explains what the editor is for when there are no fields", () => {
    setup({ fields: [] });
    expect(screen.getByText(/No custom fields/i)).toBeInTheDocument();
  });
});
