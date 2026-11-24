import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CaptioningSettings, uncaptionedSummary } from "./captioning-settings";

const mocks = vi.hoisted(() => ({
  getConfiguration: vi.fn(),
  getModelStatus: vi.fn(),
  getEmbeddingStatus: vi.fn(),
  getImageSearch: vi.fn(),
  update: vi.fn(),
  download: vi.fn(),
  cancel: vi.fn(),
}));

Object.defineProperties(HTMLElement.prototype, {
  hasPointerCapture: { value: () => false },
  releasePointerCapture: { value: () => undefined },
  scrollIntoView: { value: () => undefined },
  setPointerCapture: { value: () => undefined },
});

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
  appCaptioningGetQueryKey: () => ["appCaptioningGet"],
  appCaptionModelStatusOptions: () => ({
    queryKey: ["appCaptionModelStatus"],
    queryFn: mocks.getModelStatus,
  }),
  appCaptionModelStatusQueryKey: () => ["appCaptionModelStatus"],
  appKnowledgeEmbeddingStatusOptions: () => ({
    queryKey: ["appKnowledgeEmbeddingStatus"],
    queryFn: mocks.getEmbeddingStatus,
  }),
  appImageSearchStatusOptions: () => ({
    queryKey: ["appImageSearchStatus"],
    queryFn: mocks.getImageSearch,
  }),
  appCaptioningUpdateMutation: () => ({ mutationFn: mocks.update }),
  appCaptionModelDownloadMutation: () => ({ mutationFn: mocks.download }),
  appCaptionModelCancelMutation: () => ({ mutationFn: mocks.cancel }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderSettings() {
  return render(<CaptioningSettings />, { wrapper: Wrapper });
}

describe("captioning settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getImageSearch.mockResolvedValue({
      uncaptioned_images: 0,
      waiting_for_caption: 0,
    });
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
    mocks.getEmbeddingStatus.mockResolvedValue({
      status: "downloading",
      bytes_downloaded: 123,
      total_bytes: 456,
      model_id: "Xenova/clip-vit-base-patch32",
      revision: "dcb5f6119fdbb94f1053e98bd74da0ac582ed2a7",
      error: null,
      bundle_sha256: null,
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
    await screen.findByRole("heading", { name: "Knowledge processing" });

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

  it("shows automatic embedding provisioning without a manual install control", async () => {
    renderSettings();
    await screen.findByRole("heading", { name: "Knowledge embeddings" });
    expect(screen.getByText(/Model status:/)).toHaveTextContent("downloading");
    expect(
      screen.getByText(/Files uploaded while it is preparing remain queued/),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /embedding/i })).toBeNull();
  });

  it("offers only discovered active vision models for provider captioning", async () => {
    const user = userEvent.setup();
    renderSettings();
    await screen.findByRole("heading", { name: "Knowledge processing" });

    await user.click(screen.getByLabelText("Configured vision provider"));
    expect(
      screen.getByText(/Selecting a provider sends source images/),
    ).toBeVisible();
    const select = screen.getByLabelText("Vision model");
    await user.click(select);
    await user.click(
      await screen.findByRole("option", {
        name: "Vision provider — vision-model",
      }),
    );
    await waitFor(() =>
      expect(mocks.update.mock.calls[0]?.[0]).toEqual({
        body: {
          mode: "provider",
          provider_model_id: "10000000-0000-4000-8000-000000000001",
        },
      }),
    );
  });

  it("shows a policy-transition validation error without hiding the current policy", async () => {
    mocks.update.mockRejectedValue({
      detail: "Captioning requires an active discovered vision-capable model",
    });
    const user = userEvent.setup();
    renderSettings();
    await screen.findByRole("heading", { name: "Knowledge processing" });

    await user.click(screen.getByLabelText("Local SmolVLM2 (CPU)"));
    expect(
      await screen.findByText(
        "Captioning requires an active discovered vision-capable model",
      ),
    ).toBeVisible();
    expect(screen.getByText(/Image captioning is one part/)).toBeVisible();
  });
});

describe("images need captions to be found (US-99.3)", () => {
  beforeEach(() => {
    mocks.getConfiguration.mockResolvedValue({
      mode: "disabled",
      provider_model_id: null,
      updated_at: 1,
    });
    mocks.getModelStatus.mockResolvedValue({ status: "idle" });
    mocks.getEmbeddingStatus.mockResolvedValue({ status: "ready" });
  });

  it("says search finds images only by caption, and so does Disabled", async () => {
    mocks.getImageSearch.mockResolvedValue({
      uncaptioned_images: 3,
      waiting_for_caption: 0,
    });
    renderSettings();
    expect(
      await screen.findByText(/Search finds images only by their caption/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Disabled" }),
    ).toHaveAccessibleDescription("No captions, so search can't find images.");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "3 images have no caption, so search can't find them.",
    );
  });

  it("shows no count when every image has a caption", async () => {
    mocks.getImageSearch.mockResolvedValue({
      uncaptioned_images: 0,
      waiting_for_caption: 0,
    });
    renderSettings();
    await screen.findByText(/Search finds images only by their caption/);
    await waitFor(() => expect(mocks.getImageSearch).toHaveBeenCalled());
    expect(screen.queryByText(/have no caption|has no caption/)).toBeNull();
  });

  it.each([
    [1, 0, "1 image has no caption, so search can't find it."],
    [
      1,
      1,
      "1 image has no caption, so search can't find it. It is waiting for one.",
    ],
    [
      4,
      4,
      "4 images have no caption, so search can't find them. They are all waiting for one.",
    ],
    [
      4,
      1,
      "4 images have no caption, so search can't find them. 1 of them is waiting for one.",
    ],
    [
      4,
      2,
      "4 images have no caption, so search can't find them. 2 of them are waiting for one.",
    ],
  ])("summarises %i uncaptioned, %i waiting", (count, waiting, text) => {
    expect(uncaptionedSummary(count, waiting)).toBe(text);
  });
});
