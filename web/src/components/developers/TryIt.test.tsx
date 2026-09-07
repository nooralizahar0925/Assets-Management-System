import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TryIt, { buildUrl } from "./TryIt";

const originalFetch = global.fetch;

const respondWith = (body: unknown, init: ResponseInit = {}) =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "req-123" },
      ...init,
    }),
  );

beforeEach(() => {
  global.fetch = respondWith({ data: [] }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("building the URL", () => {
  it("fills path parameters", () => {
    expect(buildUrl("/api/v1/assets/{id}", [{ name: "id", in: "path" }], { id: "abc" }))
      .toBe("/api/v1/assets/abc");
  });

  it("escapes what it puts in the path", () => {
    expect(buildUrl("/api/v1/assets/{id}", [{ name: "id", in: "path" }], { id: "a/b" }))
      .toBe("/api/v1/assets/a%2Fb");
  });

  it("appends only the query parameters that were given", () => {
    const parameters = [{ name: "status", in: "query" }, { name: "page", in: "query" }];
    expect(buildUrl("/api/v1/assets", parameters, { status: "in_use" }))
      .toBe("/api/v1/assets?status=in_use");
  });

  it("leaves a path with nothing to fill alone", () => {
    expect(buildUrl("/api/v1/assets", [], {})).toBe("/api/v1/assets");
  });
});

describe("sending a request", () => {
  it("sends the key as a bearer token to this deployment", async () => {
    const user = userEvent.setup();
    render(<TryIt method="get" path="/api/v1/assets" parameters={[]} />);

    await user.type(screen.getByLabelText(/api key/i), "ams_live_secret");
    await user.click(screen.getByRole("button", { name: /send get/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    // A relative URL: this is not a proxy, and it cannot be pointed elsewhere.
    expect(url).toBe("/api/v1/assets");
    expect((init as RequestInit).method).toBe("GET");
    expect((init as RequestInit).headers)
      .toMatchObject({ authorization: "Bearer ams_live_secret" });
  });

  it("shows the status, the timing and the request id", async () => {
    const user = userEvent.setup();
    render(<TryIt method="get" path="/api/v1/assets" parameters={[]} />);

    await user.click(screen.getByRole("button", { name: /send get/i }));

    expect(await screen.findByText(/200/)).toBeInTheDocument();
    // The id is what a reader quotes to support; printing the body alone
    // leaves them with nothing to identify the request by.
    expect(screen.getByText(/req-123/)).toBeInTheDocument();
  });

  it("will not send until a path parameter is filled in", async () => {
    render(
      <TryIt method="get" path="/api/v1/assets/{id}" parameters={[{ name: "id", in: "path" }]} />,
    );
    expect(screen.getByRole("button", { name: /send get/i })).toBeDisabled();
    expect(screen.getByText(/fill in id/i)).toBeInTheDocument();
  });

  it("asks before a write, because it really writes", async () => {
    // Nothing on this page hints that it is a sandbox, and it is not one: the
    // key decides whose data changes.
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<TryIt method="post" path="/api/v1/assets" parameters={[]} />);

    await user.click(screen.getByRole("button", { name: /send post/i }));

    expect(confirm).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends the write once it is confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<TryIt method="post" path="/api/v1/assets" parameters={[]} />);

    await user.type(screen.getByLabelText(/request body/i), '{{"name": "X"}');
    await user.click(screen.getByRole("button", { name: /send post/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    expect((init as RequestInit).body).toBe('{"name": "X"}');
    expect((init as RequestInit).headers)
      .toMatchObject({ "content-type": "application/json" });
  });

  it("offers no body field on a read", () => {
    render(<TryIt method="get" path="/api/v1/assets" parameters={[]} />);
    expect(screen.queryByLabelText(/request body/i)).not.toBeInTheDocument();
  });

  it("shows a failed request rather than swallowing it", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Failed to fetch")) as never;
    const user = userEvent.setup();
    render(<TryIt method="get" path="/api/v1/assets" parameters={[]} />);

    await user.click(screen.getByRole("button", { name: /send get/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to fetch/i);
  });

  it("says the key is not stored, and does not store it", async () => {
    const user = userEvent.setup();
    render(<TryIt method="get" path="/api/v1/assets" parameters={[]} />);

    await user.type(screen.getByLabelText(/api key/i), "ams_live_secret");
    expect(screen.getByText(/never stored/i)).toBeInTheDocument();
    expect(JSON.stringify(localStorage)).not.toContain("ams_live_secret");
  });
});
