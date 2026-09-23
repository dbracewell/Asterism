import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CaptioningSettings } from "./captioning-settings";

const mocks = vi.hoisted(() => ({
  getConfiguration: vi.fn(),
  getModelStatus: vi.fn(),
  update: vi.fn(),
  download: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  appCaptioningProviderModelsGetOptions: () => ({
    queryKey: ["appCaptioningProviderModelsGet"],
    queryFn: () =>
      Promise.resolve([
        {
          id: "10000000-0000-4000-8000-000000000001",
          provider_id: "20000000-0000-4000-8000-000000000001",
          provider_name: "Vision provider",
          name: "vision-model",
          context_window_source: "provider",
          vision_source: "provider",
        },
      ]),
  }),
  appCaptioningGetOptions: () => ({
    queryKey: ["appCaptioningGet"],
    queryFn: mocks.getConfiguration,
  }),
  appCaptionModelStatusOptions: () => ({
    queryKey: ["appCaptionModelStatus"],
    queryFn: mocks.getModelStatus,
  }),
  appCaptioningUpdateMutation: () => ({ mutationFn: mocks.update }),
  appCaptionModelDownloadMutation: () => ({ mutationFn: mocks.download }),
  appCaptionModelCancelMutation: () => ({ mutationFn: mocks.cancel }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      {children}
    </QueryClientProvider>
  );
}

function renderSettings() {
  return render(<CaptioningSettings />, { wrapper: Wrapper });
}

describe("captioning settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfiguration.mockResolvedValue({
      mode: "disabled",
      provider_model_id: null,
      updated_at: 1,
    });
    mocks.getModelStatus.mockResolvedValue({
      status: "idle",
      bytes_downloaded: 0,
      total_bytes: 0,
    });
    mocks.update.mockResolvedValue({
      mode: "local",
      provider_model_id: null,
      updated_at: 2,
    });
    mocks.download.mockResolvedValue({
      status: "downloading",
      bytes_downloaded: 0,
      total_bytes: 1,
    });
  });

  it("shows local provisioning status and starts a download only on admin action", async () => {
    const user = userEvent.setup();
    renderSettings();
    await screen.findByRole("heading", { name: "Image captioning" });

    await user.click(screen.getByLabelText("Local SmolVLM2 (CPU)"));
    await waitFor(() =>
      expect(mocks.update.mock.calls[0]?.[0]).toEqual({
        body: { mode: "local", provider_model_id: null },
      }),
    );
    expect(
      screen.getByRole("button", { name: "Download model" }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Download model" }));
    expect(mocks.download.mock.calls[0]?.[0]).toEqual({});
  });

  it("offers only discovered active vision models for provider captioning", async () => {
    const user = userEvent.setup();
    renderSettings();
    await screen.findByRole("heading", { name: "Image captioning" });

    await user.click(screen.getByLabelText("Configured vision provider"));
    const select = screen.getByLabelText("Vision model");
    expect(
      screen.getByRole("option", { name: "Vision provider — vision-model" }),
    ).toBeVisible();

    await user.selectOptions(select, "10000000-0000-4000-8000-000000000001");
    await waitFor(() =>
      expect(mocks.update.mock.calls[0]?.[0]).toEqual({
        body: {
          mode: "provider",
          provider_model_id: "10000000-0000-4000-8000-000000000001",
        },
      }),
    );
  });
});
