import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MappingStep from "./MappingStep";
import type { FieldDef } from "../../api/types";

const headers = ["Asset Name", "Serial Number", "Cost Centre"];
const sample = [
  { "Asset Name": "Dell Latitude", "Serial Number": "DL-1", "Cost Centre": "IT-01" },
];
const schema: FieldDef[] = [
  { key: "os", label: "Operating System", type: "string", required: false },
];

const setup = (over: Partial<React.ComponentProps<typeof MappingStep>> = {}) => {
  const onChange = vi.fn();
  render(
    <MappingStep
      headers={headers}
      sample={sample}
      schema={schema}
      value={{ "Asset Name": "name", "Serial Number": "serial_no" }}
      onChange={onChange}
      {...over}
    />,
  );
  return { onChange };
};

describe("MappingStep", () => {
  it("lists every column from the file", () => {
    setup();
    for (const header of headers) expect(screen.getByText(header)).toBeInTheDocument();
  });

  it("shows a sample value so the user can see what they are mapping", () => {
    setup();
    expect(screen.getByText("Dell Latitude")).toBeInTheDocument();
  });

  it("preselects the suggested target field", () => {
    setup();
    expect(screen.getByLabelText(/Map Asset Name/)).toHaveValue("name");
  });

  it("offers custom fields from the chosen category", () => {
    setup();
    const select = screen.getByLabelText(/Map Cost Centre/) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toContain("custom.os");
  });

  it("lets a column be skipped", () => {
    setup();
    const select = screen.getByLabelText(/Map Cost Centre/) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toContain("");
  });

  it("reports a mapping change", async () => {
    const { onChange } = setup();
    await userEvent.selectOptions(screen.getByLabelText(/Map Cost Centre/), "custom.os");
    expect(onChange).toHaveBeenCalledWith("Cost Centre", "custom.os");
  });

  it("warns when no column is mapped to name", () => {
    setup({ value: { "Serial Number": "serial_no" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/name/i);
  });

  it("does not warn once name is mapped", () => {
    setup();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
