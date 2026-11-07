import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ImportSettings } from "./import-settings";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), importSettings: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  appSettingsImportPreviewMutation: () => ({ mutationFn: mocks.preview }),
  appSettingsImportMutation: () => ({ mutationFn: mocks.importSettings }),
}));

const SOURCE = '{"format":"asterism.settings-export"}';
const SUMMARY = {
  exported_at: 1_700_000_000,
  providers: [
    { name: "Local", action: "update", models_added: 1, models_updated: 2 },
    { name: "New", action: "add", models_added: 3, models_updated: 0 },
  ],
  kept_providers: ["Other"],
  changed_settings: ["Active tools"],
};

function setup(onImported?: () => void) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ImportSettings onImported={onImported} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(
    screen.getByLabelText("Settings file"),
    new File([SOURCE], "settings.json", { type: "application/json" }),
  );
  await user.type(screen.getByLabelText("File passphrase"), "the passphrase");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Preview import" }),
    ).toBeEnabled(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview.mockResolvedValue(SUMMARY);
  mocks.importSettings.mockResolvedValue(SUMMARY);
});

it("needs a file and a passphrase, and masks the passphrase", async () => {
  const user = setup();
  expect(screen.getByRole("button", { name: "Preview import" })).toBeDisabled();
  expect(screen.getByLabelText("File passphrase")).toHaveAttribute(
    "type",
    "password",
  );
  await fill(user);
});

it("previews the changes and imports nothing until confirmed", async () => {
  const user = setup();
  await fill(user);
  await user.click(screen.getByRole("button", { name: "Preview import" }));
  expect(
    await screen.findByText(/Update Local \(1 new model, 2 updated models\)/),
  ).toHaveTextContent("replacing its API key");
  expect(screen.getByText(/Add New/)).toBeInTheDocument();
  expect(screen.getByText("Active tools")).toBeInTheDocument();
  expect(screen.getByText(/Staying as they are: Other/)).toBeInTheDocument();
  expect(mocks.preview.mock.calls[0][0]).toEqual({
    body: { source: SOURCE, passphrase: "the passphrase" },
  });
  expect(mocks.importSettings).not.toHaveBeenCalled();
});

it("imports on confirmation, clears the passphrase and reports back", async () => {
  const onImported = vi.fn();
  const user = setup(onImported);
  await fill(user);
  await user.click(screen.getByRole("button", { name: "Preview import" }));
  await user.click(
    await screen.findByRole("button", { name: "Import settings" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Settings imported",
  );
  expect(mocks.importSettings.mock.calls[0][0]).toEqual({
    body: { source: SOURCE, passphrase: "the passphrase" },
  });
  expect(screen.getByLabelText("File passphrase")).toHaveValue("");
  expect(onImported).toHaveBeenCalled();
});

it("shows why a file could not be opened", async () => {
  mocks.preview.mockRejectedValue({ detail: "Could not open this file." });
  const user = setup();
  await fill(user);
  await user.click(screen.getByRole("button", { name: "Preview import" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not open this file.",
  );
  expect(
    screen.queryByRole("button", { name: "Import settings" }),
  ).not.toBeInTheDocument();
});

it("keeps the preview open when the import fails", async () => {
  mocks.importSettings.mockRejectedValue({ detail: "Settings changed" });
  const onImported = vi.fn();
  const user = setup(onImported);
  await fill(user);
  await user.click(screen.getByRole("button", { name: "Preview import" }));
  await user.click(
    await screen.findByRole("button", { name: "Import settings" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Settings changed",
  );
  expect(screen.getByLabelText("File passphrase")).toHaveValue(
    "the passphrase",
  );
  expect(onImported).not.toHaveBeenCalled();
});

it("drops the preview when the passphrase changes", async () => {
  const user = setup();
  await fill(user);
  await user.click(screen.getByRole("button", { name: "Preview import" }));
  await screen.findByRole("button", { name: "Import settings" });
  await user.type(screen.getByLabelText("File passphrase"), "x");
  expect(
    screen.queryByRole("button", { name: "Import settings" }),
  ).not.toBeInTheDocument();
});

it("refuses an oversized file without sending it", async () => {
  const user = setup();
  await user.upload(
    screen.getByLabelText("Settings file"),
    new File(["x".repeat(8 * 1024 * 1024 + 1)], "big.json", {
      type: "application/json",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("8 MiB");
  expect(mocks.preview).not.toHaveBeenCalled();
});
