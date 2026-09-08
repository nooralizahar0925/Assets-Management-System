import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import HistoryTimeline, { describeEvent } from "./HistoryTimeline";
import type { AuditEvent } from "../../api/types";

const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: "e1", asset_id: "a1", actor_type: "user", actor_label: "Rina",
  event: "asset.created", changes: {}, note: null,
  created_at: "2026-09-01T10:00:00Z", ...over,
});

describe("describeEvent", () => {
  it("describes creation in plain language", () => {
    expect(describeEvent(event())).toBe("created this asset");
  });

  it("names the fields an update changed", () => {
    expect(describeEvent(event({
      event: "asset.updated",
      changes: { status: { from: "available", to: "maintenance" } },
    }))).toBe("changed status from available to maintenance");
  });

  it("summarises an update touching several fields", () => {
    const text = describeEvent(event({
      event: "asset.updated",
      changes: {
        name: { from: "A", to: "B" },
        serial_no: { from: null, to: "SN-1" },
      },
    }));
    expect(text).toContain("name");
    expect(text).toContain("serial_no");
  });

  it("describes check-out and check-in", () => {
    expect(describeEvent(event({ event: "asset.checked_out" }))).toMatch(/checked out/i);
    expect(describeEvent(event({ event: "asset.checked_in" }))).toMatch(/checked in/i);
  });

  it("falls back to the raw event name for an unknown type", () => {
    expect(describeEvent(event({ event: "asset.teleported" }))).toContain("teleported");
  });
});

describe("HistoryTimeline", () => {
  it("renders one entry per event with its actor", () => {
    render(<HistoryTimeline events={[event(), event({ id: "e2", actor_label: "Budi" })]} assignments={[]} />);
    expect(screen.getByText("Rina")).toBeInTheDocument();
    expect(screen.getByText("Budi")).toBeInTheDocument();
  });

  it("shows a note when the event carries one", () => {
    render(<HistoryTimeline events={[event({ event: "asset.note", note: "Screen scratched" })]} assignments={[]} />);
    expect(screen.getByText("Screen scratched")).toBeInTheDocument();
  });

  it("renders an empty state rather than a blank panel", () => {
    render(<HistoryTimeline events={[]} assignments={[]} />);
    expect(screen.getByText(/No activity yet/i)).toBeInTheDocument();
  });

  it("attributes a system event to the scheduler rather than a person", () => {
    render(<HistoryTimeline events={[event({ actor_type: "system", actor_label: "Scheduler" })]} assignments={[]} />);
    expect(screen.getByText("Scheduler")).toBeInTheDocument();
  });
});
