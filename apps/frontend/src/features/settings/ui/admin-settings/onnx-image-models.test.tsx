import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { OnnxImageModels } from "./onnx-image-models";

const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  select: vi.fn(),
  download: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  onnxImageOverviewOptions: () => ({
    queryKey: [{ _id: "onnx" }],
    queryFn: () => mocks.overview(),
  }),
  onnxImageOverviewQueryKey: () => [{ _id: "onnx" }],
  onnxImageSelectMutation: () => ({ mutationFn: mocks.select }),
  onnxImageDownloadMutation: () => ({ mutationFn: mocks.download }),
  onnxImageCancelDownloadMutation: () => ({ mutationFn: mocks.cancel }),
  onnxImageRemoveMutation: () => ({ mutationFn: mocks.remove }),
}));

const model = (id: string, values: Record<string, unknown> = {}) => ({
  id,
  name: id,
  repo: `davidb727/${id}`,
  revision: "r",
  license: "CreativeML Open RAIL-M",
  license_url: `https://huggingface.co/davidb727/${id}/blob/r/LICENSE`,
  commercial_use: true,
  attribution: null,
  description: `About ${id}`,
  download_gb: 1.6,
  memory_gb: 5.2,
  steps: 4,
  plan: { fits: true, detail: "Runs on the CPU; about 5 s per image" },
  download: { status: "idle", bytes_downloaded: 0, total_bytes: 1.6e9 },
  license_accepted: true,
  ...values,
});

const overview = (values: Record<string, unknown> = {}) => ({
  memory_gb: 16,
  recommended_id: "lcm",
  settings: { model_id: null, accepted_licenses: [] },
  worker_running: false,
  models: [
    model("lcm"),
    model("sdxl", {
      license: "Stability AI Community License",
      commercial_use: false,
      license_accepted: false,
      attribution: "Powered by Stability AI",
    }),
    model("huge", {
      plan: {
        fits: false,
        detail: "Needs about 40 GB of memory; this server has 16 GB",
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
      <OnnxImageModels />
    </QueryClientProvider>,
  );
}

const row = (name: string) => screen.findByRole("listitem", { name });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.overview.mockResolvedValue(overview());
});

it("shows server memory, the recommendation, licenses and what doesn't fit", async () => {
  setup();
  expect(await screen.findByTestId("server-memory")).toHaveTextContent("16 GB");
  expect(within(await row("lcm")).getByText("Recommended")).toBeVisible();
  const sdxl = await row("sdxl");
  expect(within(sdxl).getByText("License to accept")).toBeVisible();
  expect(within(sdxl).getByTestId("attribution")).toHaveTextContent(
    "Powered by Stability AI",
  );
  expect(
    within(sdxl).getByRole("link", { name: "Stability AI Community License" }),
  ).toHaveAttribute("href", expect.stringContaining("davidb727/sdxl"));
  const huge = await row("huge");
  expect(within(huge).getByText(/Needs about 40 GB/)).toBeVisible();
  expect(within(huge).getByRole("button", { name: "Download" })).toBeDisabled();
});

it("asks for the license before downloading a model that limits use", async () => {
  mocks.download.mockResolvedValue(overview());
  setup();
  const user = userEvent.setup();
  await user.click(
    within(await row("sdxl")).getByRole("button", { name: "Download" }),
  );
  expect(mocks.download).not.toHaveBeenCalled();
  await user.click(
    await screen.findByRole("button", { name: "Accept and download" }),
  );
  await waitFor(() =>
    expect(mocks.download).toHaveBeenCalledWith(
      { path: { model_id: "sdxl" }, body: { accept_license: true } },
      expect.anything(),
    ),
  );
});

it("downloads a model with a permissive license directly", async () => {
  mocks.download.mockResolvedValue(overview());
  setup();
  const user = userEvent.setup();
  await user.click(
    within(await row("lcm")).getByRole("button", { name: "Download" }),
  );
  await waitFor(() =>
    expect(mocks.download).toHaveBeenCalledWith(
      { path: { model_id: "lcm" }, body: { accept_license: false } },
      expect.anything(),
    ),
  );
});

it("uses a downloaded model", async () => {
  mocks.overview.mockResolvedValue(
    overview({
      models: [
        model("lcm", {
          download: {
            status: "ready",
            bytes_downloaded: 1.6e9,
            total_bytes: 1.6e9,
          },
        }),
      ],
    }),
  );
  mocks.select.mockResolvedValue(overview());
  setup();
  const user = userEvent.setup();
  await user.click(
    within(await row("lcm")).getByRole("button", { name: "Use this model" }),
  );
  await waitFor(() =>
    expect(mocks.select).toHaveBeenCalledWith(
      { body: { model_id: "lcm" } },
      expect.anything(),
    ),
  );
});

it("shows download progress and cancels", async () => {
  mocks.overview.mockResolvedValue(
    overview({
      models: [
        model("lcm", {
          download: {
            status: "downloading",
            bytes_downloaded: 0.8e9,
            total_bytes: 1.6e9,
          },
        }),
      ],
    }),
  );
  mocks.cancel.mockResolvedValue(overview());
  setup();
  const user = userEvent.setup();
  const lcm = await row("lcm");
  expect(
    within(lcm).getByRole("progressbar", { name: "Downloading lcm" }),
  ).toBeVisible();
  expect(within(lcm).getByText("0.8 GB of 1.6 GB")).toBeVisible();
  await user.click(
    within(lcm).getByRole("button", { name: "Cancel download" }),
  );
  await waitFor(() =>
    expect(mocks.cancel).toHaveBeenCalledWith(
      { path: { model_id: "lcm" } },
      expect.anything(),
    ),
  );
});
