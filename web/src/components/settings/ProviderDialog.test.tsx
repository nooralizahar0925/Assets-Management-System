import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProviderDialog from "./ProviderDialog";
import { settingsApi } from "../../api/settings";

vi.mock("../../api/settings", async (importOriginal) => {
  // PROVIDER_FIELDS and PROVIDER_LABELS are data the dialog renders from, not
  // calls to stub; only the request functions are mocked.
  const actual = await importOriginal<typeof import("../../api/settings")>();
  return {
    ...actual,
    settingsApi: {
      createProvider: vi.fn(),
      updateProvider: vi.fn(),
    },
  };
});

beforeEach(() => {
  // Module mocks record calls for the whole file; without clearing, mock.calls[0]
  // can belong to an earlier test.
  vi.clearAllMocks();
  vi.mocked(settingsApi.createProvider).mockResolvedValue({} as never);
  vi.mocked(settingsApi.updateProvider).mockResolvedValue({} as never);
});

const existing = {
  id: "p1", name: "Primary", type: "sendgrid" as const, from_email: "ams@example.com",
  from_name: null, reply_to: null, priority: 10, active: true,
  config: { api_key: "SG.••••4f2a" }, verified_at: null, last_error: null,
};

const setup = (provider?: typeof existing) => {
  const onDone = vi.fn();
  render(
    <ProviderDialog isOpen provider={provider} onClose={vi.fn()} onDone={onDone} />,
  );
  return { onDone };
};

describe("ProviderDialog", () => {
  it("shows SMTP fields when SMTP is chosen", async () => {
    setup();
    await userEvent.selectOptions(screen.getByLabelText(/Provider type/), "smtp");
    expect(screen.getByLabelText(/Host/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Port/)).toBeInTheDocument();
  });

  it("shows a single API key field for SendGrid", async () => {
    setup();
    await userEvent.selectOptions(screen.getByLabelText(/Provider type/), "sendgrid");
    expect(screen.getByLabelText(/API key/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Host/)).not.toBeInTheDocument();
  });

  it("swaps the fields when the type changes", async () => {
    setup();
    await userEvent.selectOptions(screen.getByLabelText(/Provider type/), "smtp");
    await userEvent.selectOptions(screen.getByLabelText(/Provider type/), "mailgun");
    expect(screen.getByLabelText(/Domain/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Host/)).not.toBeInTheDocument();
  });

  it("renders a secret as a password field", async () => {
    setup();
    await userEvent.selectOptions(screen.getByLabelText(/Provider type/), "sendgrid");
    expect(screen.getByLabelText(/API key/)).toHaveAttribute("type", "password");
  });

  it("creates a provider with the config nested under config", async () => {
    const { onDone } = setup();
    await userEvent.type(screen.getByLabelText(/Display name/), "Primary");
    await userEvent.type(screen.getByLabelText(/From address/), "ams@example.com");
    await userEvent.selectOptions(screen.getByLabelText(/Provider type/), "sendgrid");
    await userEvent.type(screen.getByLabelText(/API key/), "SG.test");
    await userEvent.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => expect(settingsApi.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Primary", type: "sendgrid", from_email: "ams@example.com",
        config: { api_key: "SG.test" },
      }),
    ));
    expect(onDone).toHaveBeenCalled();
  });

  it("shows the masked secret as a placeholder when editing", () => {
    setup(existing);
    expect(screen.getByLabelText(/API key/))
      .toHaveAttribute("placeholder", expect.stringContaining("••••"));
  });

  it("omits an untouched secret so saving does not overwrite the stored key", async () => {
    setup(existing);
    await userEvent.clear(screen.getByLabelText(/Priority/));
    await userEvent.type(screen.getByLabelText(/Priority/), "20");
    await userEvent.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => {
      const body = vi.mocked(settingsApi.updateProvider).mock.calls[0][1];
      expect(body.config).toEqual({});
      expect(body.priority).toBe(20);
    });
  });
});
