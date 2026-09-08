import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../../context/AuthContext";
import AssetAttachments from "./AssetAttachments";
import type { Attachment } from "../../api/types";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

const attachment = (over: Partial<Attachment> = {}): Attachment => ({
  id: "at1", kind: "photo", filename: "front.png", content_type: "image/png",
  size_bytes: "2048", created_at: "2026-09-01T10:00:00Z", ...over,
});

const renderAs = (permissions: string[], attachments: Attachment[]) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(json({
    org_id: "org-1",
    user: {
      id: "u1", name: "Tester", permissions, location_scope: null, scopes: [],
    },
  }));
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AssetAttachments assetId="a1" attachments={attachments} onChanged={() => {}} />
      </AuthProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => vi.restoreAllMocks());

describe("AssetAttachments", () => {
  it("lets someone with write access upload and remove", async () => {
    renderAs(["assets:write"], [attachment()]);
    await waitFor(() =>
      expect(screen.getByLabelText(/attach files/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("shows a viewer the files but no way to change them", async () => {
    // A viewer can open a condition photo; offering them a Remove button the
    // API would refuse is worse than not offering it.
    renderAs(["assets:read"], [attachment()]);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "front.png" })).toBeInTheDocument());
    expect(screen.queryByLabelText(/attach files/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  it("words the empty state for what the reader can actually do", async () => {
    renderAs(["assets:read"], []);
    await waitFor(() =>
      expect(screen.getByText(/no files have been attached/i)).toBeInTheDocument());
    // Not the version that tells them to attach something.
    expect(screen.queryByText(/attach condition photos/i)).not.toBeInTheDocument();
  });

  it("invites an editor to attach the first file", async () => {
    renderAs(["assets:write"], []);
    await waitFor(() =>
      expect(screen.getByText(/attach condition photos/i)).toBeInTheDocument());
  });

  it("restricts the picker to the types the API accepts", async () => {
    // Offering a file the upload would reject with 415 wastes the person's time.
    renderAs(["assets:write"], []);
    const input = await screen.findByLabelText(/attach files/i);
    const accept = input.getAttribute("accept") ?? "";
    expect(accept).toContain("image/png");
    expect(accept).toContain("application/pdf");
    expect(accept).not.toContain("application/x-msdownload");
  });
});
