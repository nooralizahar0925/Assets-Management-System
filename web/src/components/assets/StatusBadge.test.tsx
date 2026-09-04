import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatusBadge from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders a human label, not the raw enum", () => {
    render(<StatusBadge status="in_use" />);
    expect(screen.getByText("In use")).toBeInTheDocument();
  });

  it("labels every status", () => {
    for (const status of ["available", "in_use", "maintenance", "retired", "lost"] as const) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(/\w/)).toBeInTheDocument();
      unmount();
    }
  });

  it("uses success colouring for available and error colouring for lost", () => {
    const { container: ok } = render(<StatusBadge status="available" />);
    const { container: bad } = render(<StatusBadge status="lost" />);
    expect(ok.innerHTML).toContain("success");
    expect(bad.innerHTML).toContain("error");
  });
});
