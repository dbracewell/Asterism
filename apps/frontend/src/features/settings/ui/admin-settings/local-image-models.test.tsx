import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { LocalImageModels } from "./local-image-models";

const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  select: vi.fn(),
  download: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  localImageOverviewOptions: () => ({
    queryKey: [{ _id: "local" }],
    queryFn: () => mocks.overview(),
  }),
  localImageOverviewQueryKey: () => [{ _id: "local" }],
  localImageSelectMutation: () => ({ mutationFn: mocks.select }),
  localImageDownloadMutation: () => ({ mutationFn: mocks.download }),
  localImageCancelDownloadMutation: () => ({ mutationFn: mocks.cancel }),
  localImageRemoveMutation: () => ({ mutationFn: mocks.remove }),
}));

const model = (id: string, values: Record<string, unknown> = {}) => ({
  id,
  name: id,
  repo: `org/${id}`,
  revision: "r",
  license: "Apache 2.0",
  commercial_use: true,
  description: `About ${id}`,
  disk_gb: 16,
  memory_gb: 18,
  plan: { fits: true, mode: "device", detail: "Runs fully on Test GPU" },
  download: { status: "idle", bytes_downloaded: 0, total_bytes: 16e9 },
  license_accepted: true,
  ...values,
});

const overview = (values: Record<string, unknown> = {}) => ({
  installed: true,
  hardware: {
    device: "cuda",
    name: "Test GPU",
    memory_gb: 24,
    system_ram_gb: 64,
    cpu_count: 8,
    bf16: true,
    available: ["cuda", "cpu"],
  },
  recommended_id: "qwen",
  settings: { model_id: null, device: "auto", accepted_licenses: [] },
  worker_running: false,
  models: [
    model("qwen", {
      license: "Qwen Research License (non-commercial)",
      commercial_use: false,
      license_accepted: false,
    }),
    model("flux"),
    model("huge", {
      plan: {
        fits: false,
        mode: "none",
        detail: "Needs about 40 GB of GPU memory",
      },
    }),
  ],
  ...values,
});

function setup() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <LocalImageModels />
    </QueryClientProvider>,
  );
}

const row = (name: string) => screen.findByRole("listitem", { name });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.overview.mockResolvedValue(overview());
});

it("shows the hardware, the recommendation and what doesn't fit", async () => {
  setup();
  expect(await screen.findByTestId("hardware")).toHaveTextContent(
    "Test GPU · 24 GB GPU memory",
  );
  expect(within(await row("qwen")).getByText("Recommended")).toBeVisible();
  expect(within(await row("qwen")).getByText("Non-commercial")).toBeVisible();
  const huge = await row("huge");
  expect(within(huge).getByText(/Needs about 40 GB/)).toBeVisible();
  expect(within(huge).getByRole("button", { name: "Download" })).toBeDisabled();
});

it("asks for the license before downloading a non-commercial model", async () => {
  mocks.download.mockResolvedValue(overview());
  setup();
  const user = userEvent.setup();
  await user.click(
    within(await row("qwen")).getByRole("button", { name: "Download" }),
  );
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent("Qwen Research License (non-commercial)");
  expect(mocks.download).not.toHaveBeenCalled();
  await user.click(
    within(dialog).getByRole("button", { name: "Accept and download" }),
  );
  await waitFor(() =>
    expect(mocks.download.mock.calls[0][0]).toEqual({
      path: { model_id: "qwen" },
      body: { accept_license: true },
    }),
  );

  // A permissively licensed model downloads straight away.
  await user.click(
    within(await row("flux")).getByRole("button", { name: "Download" }),
  );
  await waitFor(() =>
    expect(mocks.download.mock.calls[1][0]).toEqual({
      path: { model_id: "flux" },
      body: { accept_license: false },
    }),
  );
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("shows download progress and lets it be cancelled", async () => {
  mocks.overview.mockResolvedValue(
    overview({
      models: [
        model("flux", {
          download: {
            status: "downloading",
            bytes_downloaded: 4e9,
            total_bytes: 16e9,
          },
        }),
      ],
    }),
  );
  mocks.cancel.mockResolvedValue(overview({ models: [model("flux")] }));
  setup();
  const user = userEvent.setup();
  const flux = await row("flux");
  expect(
    within(flux).getByRole("progressbar", { name: "Downloading flux" }),
  ).toBeVisible();
  expect(within(flux).getByText("4 GB of 16 GB")).toBeVisible();
  await user.click(
    within(flux).getByRole("button", { name: "Cancel download" }),
  );
  await waitFor(() =>
    expect(mocks.cancel.mock.calls[0][0]).toEqual({
      path: { model_id: "flux" },
    }),
  );
  expect(
    await within(await row("flux")).findByRole("button", { name: "Download" }),
  ).toBeEnabled();
});

it("uses, switches device for and removes a downloaded model", async () => {
  const ready = model("flux", {
    download: { status: "ready", bytes_downloaded: 16e9, total_bytes: 16e9 },
  });
  mocks.overview.mockResolvedValue(overview({ models: [ready] }));
  const inUse = overview({
    models: [ready],
    settings: { model_id: "flux", device: "auto", accepted_licenses: [] },
  });
  mocks.select.mockResolvedValue(inUse);
  mocks.remove.mockRejectedValue({ detail: "The files are in use" });
  setup();
  const user = userEvent.setup();
  await user.click(
    within(await row("flux")).getByRole("button", { name: "Use this model" }),
  );
  await waitFor(() =>
    expect(mocks.select.mock.calls[0][0]).toEqual({
      body: { model_id: "flux", device: "auto" },
    }),
  );
  expect(await within(await row("flux")).findByText("In use")).toBeVisible();
  expect(
    within(await row("flux")).queryByRole("button", { name: "Use this model" }),
  ).toBeNull();

  await user.click(screen.getByRole("combobox", { name: "Run on" }));
  await user.click(await screen.findByRole("option", { name: "CPU" }));
  await waitFor(() =>
    expect(mocks.select.mock.calls[1][0]).toEqual({
      body: { model_id: "flux", device: "cpu" },
    }),
  );

  await user.click(
    within(await row("flux")).getByRole("button", { name: "Remove files" }),
  );
  expect(await screen.findByText("The files are in use")).toBeVisible();
});

it("explains that local generation is not in this image and hides the catalog", async () => {
  mocks.overview.mockResolvedValue(
    overview({
      installed: false,
      hardware: null,
      recommended_id: null,
      models: [],
      settings: { model_id: "flux", device: "auto", accepted_licenses: [] },
    }),
  );
  setup();
  expect(
    await screen.findByTestId("local-image-unavailable"),
  ).toHaveTextContent("Local image generation is not available in this image");
  expect(screen.queryByRole("list", { name: "Local models" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
  expect(screen.queryByTestId("hardware")).toBeNull();
});
