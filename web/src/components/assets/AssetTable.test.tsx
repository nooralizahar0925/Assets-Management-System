import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import AssetTable from "./AssetTable";
import type { Asset } from "../../api/types";

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: "a1", asset_tag: "AMS-000001", name: "Dell Latitude", description: null,
  category_id: "c1", category_name: "IT", serial_no: "DL-1", status: "available",
  location_id: null, location_name: "Head Office", assignee_id: null,
  assignee_name: null, purchase_date: "2026-01-10", purchase_cost: "15000000",
  currency: "IDR", custom: {}, created_at: "2026-01-10T00:00:00Z",
  updated_at: "2026-01-10T00:00:00Z", ...over,
});

const setup = (props: Partial<React.ComponentProps<typeof AssetTable>> = {}) => {
  const onSelect = vi.fn();
  const onSort = vi.fn();
  render(
    <MemoryRouter>
      <AssetTable
        assets={[asset(), asset({ id: "a2", asset_tag: "AMS-000002", name: "MacBook", status: "in_use", assignee_name: "Rina" })]}
        selected={new Set()}
        onSelect={onSelect}
        onSelectAll={vi.fn()}
        sort="-created_at"
        onSort={onSort}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onSelect, onSort };
};

describe("AssetTable", () => {
  it("renders a row per asset", () => {
    setup();
    expect(screen.getByText("Dell Latitude")).toBeInTheDocument();
    expect(screen.getByText("MacBook")).toBeInTheDocument();
  });

  it("links each row to its detail page", () => {
    setup();
    expect(screen.getByRole("link", { name: /Dell Latitude/ }))
      .toHaveAttribute("href", "/assets/a1");
  });

  it("shows the holder when an asset is checked out", () => {
    setup();
    expect(screen.getByText("Rina")).toBeInTheDocument();
  });

  it("shows a dash rather than blank when a field is empty", () => {
    setup({ assets: [asset({ serial_no: null, location_name: null })] });
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("reports a selection when a row checkbox is ticked", async () => {
    const { onSelect } = setup();
    await userEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(onSelect).toHaveBeenCalledWith("a1");
  });

  it("requests the opposite direction when the active sort column is clicked", async () => {
    const { onSort } = setup({ sort: "name" });
    await userEvent.click(screen.getByRole("button", { name: /Asset/ }));
    expect(onSort).toHaveBeenCalledWith("-name");
  });

  it("formats purchase cost as currency", () => {
    setup();
    expect(screen.getAllByText(/15[.,]000[.,]000/).length).toBeGreaterThan(0);
  });

  it("renders an empty state that offers the next action", () => {
    setup({ assets: [] });
    expect(screen.getByText(/No assets/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Import/i })).toBeInTheDocument();
  });
});
