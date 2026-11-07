import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExportSettings } from "./export-settings";

const mocks = vi.hoisted(() => ({ exportSettings: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  appSettingsExportMutation: () => ({ mutationFn: mocks.exportSettings }),
}));

const PASSPHRASE = "correct horse battery";
const FILE = {
  format: "asterism.settings-export",
  format_version: 1,
  salt: "c2FsdA==",
  ciphertext: "token",
};

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ExportSettings />
    </QueryClientProvider>,
  );
  return {
    user: userEvent.setup(),
    first: screen.getByLabelText("Passphrase"),
    second: screen.getByLabelText("Confirm passphrase"),
    submit: screen.getByRole("button", { name: "Export settings" }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exportSettings.mockResolvedValue(FILE);
  URL.createObjectURL = vi.fn(() => "blob:settings");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

it("warns that the file holds keys and masks the passphrase", () => {
  const { first, second } = setup();
  expect(screen.getByRole("note")).toHaveTextContent("API keys");
  expect(first).toHaveAttribute("type", "password");
  expect(second).toHaveAttribute("type", "password");
});

it("needs a long enough passphrase, typed twice", async () => {
  const { user, first, second, submit } = setup();
  expect(submit).toBeDisabled();
  await user.type(first, "too short");
  await user.type(second, "too short");
  expect(submit).toBeDisabled();
  await user.clear(first);
  await user.clear(second);
  await user.type(first, PASSPHRASE);
  await user.type(second, "something else");
  expect(submit).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("don't match");
  await user.clear(second);
  await user.type(second, PASSPHRASE);
  expect(submit).toBeEnabled();
});

it("downloads the file and clears the passphrase", async () => {
  const { user, first, second, submit } = setup();
  await user.type(first, PASSPHRASE);
  await user.type(second, PASSPHRASE);
  await user.click(submit);
  await waitFor(() =>
    expect(mocks.exportSettings.mock.calls[0][0]).toEqual({
      body: { passphrase: PASSPHRASE },
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Settings exported",
  );
  expect(URL.createObjectURL).toHaveBeenCalled();
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  expect(first).toHaveValue("");
  expect(second).toHaveValue("");
});

it("reports a failure and keeps what was typed", async () => {
  mocks.exportSettings.mockRejectedValue({ detail: "nope" });
  const { user, first, second, submit } = setup();
  await user.type(first, PASSPHRASE);
  await user.type(second, PASSPHRASE);
  await user.click(submit);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not export settings",
  );
  expect(first).toHaveValue(PASSPHRASE);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
