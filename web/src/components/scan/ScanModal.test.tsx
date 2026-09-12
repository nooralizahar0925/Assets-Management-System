import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScanModal from "./ScanModal";

/**
 * The camera path, driven without a camera.
 *
 * What a machine cannot check is whether a real lens decodes a real printed
 * label — that stays a human test, on a phone, against a printed sheet. What it
 * can check is everything around it, and that is where the bugs live: a decoded
 * value that goes nowhere, a camera left running after the dialog closes, a
 * refused permission that leaves somebody staring at a dead rectangle with no
 * way to type the tag instead.
 */

const stop = vi.fn();
const decodeFromVideoDevice = vi.fn();

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromVideoDevice(
      device: unknown,
      video: unknown,
      callback: (result: { getText: () => string } | undefined) => void,
    ) {
      return decodeFromVideoDevice(device, video, callback);
    }
  },
}));

vi.mock("../../api/assets", () => ({
  assetsApi: { lookup: vi.fn() },
}));

const { assetsApi } = await import("../../api/assets");

/** Hands back the callback zxing would call when it decodes something. */
let onDecode: ((result: { getText: () => string } | undefined) => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  onDecode = null;
  decodeFromVideoDevice.mockImplementation((_device, _video, callback) => {
    onDecode = callback;
    return Promise.resolve({ stop });
  });
  vi.mocked(assetsApi.lookup).mockResolvedValue({
    id: "a1", name: "ThinkPad T14", asset_tag: "AMS-000123",
  } as never);
});

const renderModal = (onResolved = vi.fn(), onClose = vi.fn()) => {
  const result = render(
    <ScanModal isOpen onClose={onClose} onResolved={onResolved} />,
  );
  return { ...result, onResolved, onClose };
};

describe("scanning with the camera", () => {
  it("resolves a decoded tag to its asset", async () => {
    const { onResolved } = renderModal();
    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalled());

    onDecode?.({ getText: () => "AMS-000123" });

    await waitFor(() => expect(assetsApi.lookup).toHaveBeenCalledWith("AMS-000123"));
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({ asset_tag: "AMS-000123" }),
    ));
  });

  it("stops the camera the moment a scan succeeds", async () => {
    // Otherwise the lens stays live behind the next screen, which is both a
    // battery drain and the kind of thing people notice and distrust.
    renderModal();
    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalled());

    onDecode?.({ getText: () => "AMS-000123" });
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it("stops the camera when the dialog unmounts", async () => {
    const { unmount } = renderModal();
    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalled());

    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("stops a camera that became ready after the dialog was closed", async () => {
    // The race: permission granted a second after somebody gave up and closed
    // the dialog. Without the cancelled check the camera runs with no UI.
    let release: ((controls: { stop: () => void }) => void) | undefined;
    decodeFromVideoDevice.mockImplementation(
      () => new Promise<{ stop: () => void }>((resolve) => { release = resolve; }),
    );

    const { unmount } = renderModal();
    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalled());
    unmount();

    release?.({ stop });
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it("says so, and still takes a typed tag, when there is no camera", async () => {
    decodeFromVideoDevice.mockRejectedValue(new Error("NotAllowedError"));
    const { onResolved } = renderModal();

    expect(await screen.findByText(/camera unavailable/i)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/asset tag/i), "AMS-000123");
    await user.click(screen.getByRole("button", { name: /find/i }));

    await waitFor(() => expect(onResolved).toHaveBeenCalled());
  });

  it("blames the http page, not the phone, when the browser blocks the camera",
    async () => {
      // The single likeliest failure in the field. getUserMedia needs a secure
      // context, and a phone opening the LAN address over http is not one - so
      // the camera is refused before any of our code runs. "Camera unavailable"
      // sends somebody hunting through phone settings for a problem that is in
      // the URL bar.
      const secure = Object.getOwnPropertyDescriptor(window, "isSecureContext");
      Object.defineProperty(window, "isSecureContext", {
        value: false, configurable: true,
      });
      decodeFromVideoDevice.mockRejectedValue(new Error("NotAllowedError"));

      try {
        renderModal();
        const message = await screen.findByText(/https/i);
        expect(message).toHaveTextContent(/not.*(secure|https)/i);
        expect(screen.queryByText(/^Camera unavailable/)).not.toBeInTheDocument();
      } finally {
        if (secure) Object.defineProperty(window, "isSecureContext", secure);
      }
    });

  it("says permission was refused when it was refused", async () => {
    // Distinct from having no camera: the fix is to grant it, and the message
    // is the only thing that says so.
    Object.defineProperty(window, "isSecureContext", {
      value: true, configurable: true,
    });
    const refused = new Error("Permission denied");
    refused.name = "NotAllowedError";
    decodeFromVideoDevice.mockRejectedValue(refused);

    renderModal();
    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
  });

  it("names the tag that did not resolve rather than saying it failed", async () => {
    vi.mocked(assetsApi.lookup).mockRejectedValue(new Error("404"));
    renderModal();
    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalled());

    onDecode?.({ getText: () => "AMS-999999" });

    expect(await screen.findByRole("alert")).toHaveTextContent("AMS-999999");
  });

  it("ignores the frames that decode to nothing", async () => {
    // zxing calls back on every frame; most carry no result at all.
    renderModal();
    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalled());

    onDecode?.(undefined);
    onDecode?.(undefined);

    expect(assetsApi.lookup).not.toHaveBeenCalled();
  });
});
