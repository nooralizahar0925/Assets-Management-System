import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DepreciationFields, { type DepreciationPolicy } from "./DepreciationFields";

const straightLine: DepreciationPolicy = {
  method: "straight_line",
  useful_life_months: 36,
  salvage_pct: 10,
  declining_rate_pct: null,
};

/**
 * The editor is controlled, so a fixed prop would revert every keystroke and
 * the spy would see only the last character. This feeds its output back the
 * way the real form does.
 */
function Harness({
  initial, inherited, onChange,
}: {
  initial: DepreciationPolicy | null;
  inherited?: DepreciationPolicy;
  onChange: (value: DepreciationPolicy | null) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DepreciationFields
      value={value}
      inherited={inherited}
      onChange={(next) => { setValue(next); onChange(next); }}
    />
  );
}

const setup = (
  initial: DepreciationPolicy | null = straightLine,
  inherited?: DepreciationPolicy,
) => {
  const onChange = vi.fn();
  render(<Harness initial={initial} inherited={inherited} onChange={onChange} />);
  return { onChange };
};

const last = (spy: ReturnType<typeof vi.fn>) =>
  spy.mock.calls[spy.mock.calls.length - 1][0] as DepreciationPolicy | null;

describe("DepreciationFields", () => {
  it("shows a useful life for straight line and no declining rate", () => {
    setup();
    expect(screen.getByLabelText(/Useful life/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Rate per year/i)).not.toBeInTheDocument();
  });

  it("swaps to a rate when reducing balance is chosen", async () => {
    setup();
    await userEvent.selectOptions(screen.getByLabelText(/Method/i), "reducing_balance");
    expect(screen.getByLabelText(/Rate per year/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Useful life/i)).not.toBeInTheDocument();
  });

  it("clears the useful life when switching away from straight line", async () => {
    // Leaving a stale life behind would send a policy the server then stores
    // alongside a method that ignores it.
    const { onChange } = setup();
    await userEvent.selectOptions(screen.getByLabelText(/Method/i), "reducing_balance");
    expect(last(onChange)!.useful_life_months).toBeNull();
  });

  it("hides both when the method is none", async () => {
    setup();
    await userEvent.selectOptions(screen.getByLabelText(/Method/i), "none");
    expect(screen.queryByLabelText(/Useful life/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Rate per year/i)).not.toBeInTheDocument();
  });

  it("reports a life typed by the user", async () => {
    const { onChange } = setup({ ...straightLine, useful_life_months: null });
    await userEvent.type(screen.getByLabelText(/Useful life/i), "24");
    expect(last(onChange)!.useful_life_months).toBe(24);
  });

  it("refuses a useful life of zero before the server has to", async () => {
    // The database CHECK would reject it, but as a server error rather than
    // something the form can point at.
    const { onChange } = setup({ ...straightLine, useful_life_months: null });
    await userEvent.type(screen.getByLabelText(/Useful life/i), "0");
    expect(screen.getByRole("alert")).toHaveTextContent(/at least one month/i);
    expect(last(onChange)!.useful_life_months).toBe(0);
  });

  it("refuses a salvage percentage above 100", async () => {
    setup();
    const field = screen.getByLabelText(/Residual value/i);
    await userEvent.clear(field);
    await userEvent.type(field, "150");
    expect(screen.getByRole("alert")).toHaveTextContent(/between 0 and 100/i);
  });
});

describe("DepreciationFields as an asset override", () => {
  const inherited: DepreciationPolicy = {
    method: "straight_line", useful_life_months: 60,
    salvage_pct: 5, declining_rate_pct: null,
  };

  it("says what the category would give when nothing is overridden", () => {
    setup(null, inherited);
    expect(screen.getByText(/from its category/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Method/i)).not.toBeInTheDocument();
  });

  it("starts an override from the inherited values rather than blank", async () => {
    // Beginning at "none" would look like a policy change the person did not
    // ask for.
    const { onChange } = setup(null, inherited);
    await userEvent.click(screen.getByRole("button", { name: /Override/i }));
    expect(last(onChange)).toEqual(inherited);
  });

  it("can hand the asset back to its category", async () => {
    const { onChange } = setup(straightLine, inherited);
    await userEvent.click(screen.getByRole("button", { name: /Use the category/i }));
    expect(last(onChange)).toBeNull();
    expect(screen.getByText(/from its category/i)).toBeInTheDocument();
  });
});
