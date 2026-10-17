import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderSettings } from "@/lib/client";
import { OPENAI_BASE_URL, providerSchema, ProvidersTab } from "./providers-tab";

const mocks = vi.hoisted(() => ({
  listModels: vi.fn(),
  getSearchParam: vi.fn(),
  setSearchParams: vi.fn(),
  updateModel: vi.fn(),
  updateProviderSettings: vi.fn(),
}));

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const settings: ProviderSettings = {
  draft_model_id: null,
  llm_providers: [
    {
      id: "20000000-0000-4000-8000-000000000001",
      name: "Large catalog",
      provider_type: "generic_openai",
      base_url: "http://localhost:8080/v1",
      model_count: 1000,
      active_model_count: 4,
      ...{ api_key: "secret" },
    },
  ],
};

vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  appProviderModelsDiscoverAndSyncMutation: () => ({ mutationFn: vi.fn() }),
  appProviderModelsListOptions: ({
    query,
  }: {
    query: { cursor?: string };
  }) => ({
    queryKey: ["appProviderModelsList", query],
    queryFn: () => mocks.listModels(query),
  }),
  appProviderModelUpdateMutation: () => ({ mutationFn: mocks.updateModel }),
  appProviderSettingsGetOptions: () => ({
    queryKey: ["appProviderSettingsGet"],
    queryFn: () => Promise.resolve(structuredClone(settings)),
  }),
  appProviderSettingsGetQueryKey: () => ["appProviderSettingsGet"],
  appProviderSettingsUpdateMutation: () => ({
    mutationFn: mocks.updateProviderSettings,
  }),
}));

vi.mock("@/hooks/use-read-write-search-params", () => ({
  useReadWriteSearchParams: () => ({
    getSearchParam: mocks.getSearchParam,
    setSearchParams: mocks.setSearchParams,
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function createTestQueryClient() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    mutationCache: new MutationCache({
      onSuccess: () => {
        void cache.invalidateQueries();
      },
    }),
  });
  return cache;
}

function Wrapper({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createTestQueryClient);
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("provider model browser", () => {
  beforeEach(() => {
    mocks.getSearchParam.mockReset();
    mocks.setSearchParams.mockReset();
    mocks.listModels.mockReset();
    mocks.listModels.mockResolvedValue({ models: [], total: 0 });
    mocks.updateModel.mockReset();
    mocks.updateProviderSettings.mockReset();
    mocks.updateProviderSettings.mockResolvedValue({});
  });

  it("updates all displayed models and clears the filter", async () => {
    let models = [
      {
        id: "30000000-0000-4000-8000-000000000001",
        name: "Active model",
        provider_id: settings.llm_providers![0].id,
        is_active: true,
        context_window: null,
        supports_vision: null,
        context_window_source: "unknown",
        vision_source: "unknown",
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        name: "Inactive model",
        provider_id: settings.llm_providers![0].id,
        is_active: false,
        context_window: null,
        supports_vision: null,
        context_window_source: "unknown",
        vision_source: "unknown",
      },
    ];
    mocks.listModels.mockImplementation(() =>
      Promise.resolve({ models, total: models.length, next_cursor: null }),
    );
    mocks.updateModel.mockImplementation(({ path, body }) => {
      models = models.map((model) =>
        model.id === path.model_id
          ? { ...model, is_active: body.is_active }
          : model,
      );
      return Promise.resolve({});
    });

    render(<ProvidersTab appSettings={settings} />, { wrapper: Wrapper });
    fireEvent.click(
      screen.getByRole("button", { name: "Browse 1,000 models" }),
    );

    await screen.findByText("Active model");
    expect(mocks.setSearchParams).toHaveBeenCalledWith({
      provider: settings.llm_providers![0].id,
    });
    fireEvent.click(screen.getByRole("button", { name: "Select All" }));
    expect(mocks.updateModel).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Inactive model")).toBeChecked();
    fireEvent.change(screen.getAllByLabelText("Context window")[0], {
      target: { value: "8192" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unselect All" }));
    expect(screen.getByLabelText("Active model")).not.toBeChecked();
    expect(screen.getAllByLabelText("Context window")[0]).toHaveValue(8192);
    expect(mocks.updateModel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Hide models" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.updateProviderSettings).toHaveBeenCalledTimes(1),
    );
    expect(mocks.updateModel).toHaveBeenCalledTimes(2);
    expect(mocks.updateModel.mock.calls[0][0].body).toMatchObject({
      is_active: false,
      context_window: 8192,
      context_window_source: "manual",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Browse 1,000 models" }),
    );

    const filter = screen.getByLabelText("Search Large catalog models");
    fireEvent.change(filter, { target: { value: "active" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Clear Large catalog model search",
      }),
    );
    expect(filter).toHaveValue("");
  });

  it("saves edits from different catalog pages together with provider edits", async () => {
    const first = {
      id: "first-model",
      name: "First model",
      provider_id: settings.llm_providers![0].id,
      is_active: true,
      context_window: null,
    };
    const second = { ...first, id: "second-model", name: "Second model" };
    mocks.listModels.mockImplementation(({ cursor }) =>
      Promise.resolve({
        models: [cursor ? second : first],
        total: 2,
        next_cursor: cursor ? null : "page-two",
      }),
    );
    mocks.updateModel.mockResolvedValue({});
    render(<ProvidersTab />, { wrapper: Wrapper });
    fireEvent.click(
      await screen.findByRole("button", { name: "Browse 1,000 models" }),
    );
    await screen.findByText("First model");
    fireEvent.change(screen.getByLabelText("Context window"), {
      target: { value: "4096" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Second model");
    fireEvent.change(screen.getByLabelText("Context window"), {
      target: { value: "8192" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByText("First model");
    expect(screen.getByLabelText("Context window")).toHaveValue(4096);
    fireEvent.change(screen.getByLabelText("Provider Name"), {
      target: { value: "Edited provider" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.updateProviderSettings).toHaveBeenCalledTimes(1),
    );
    expect(
      mocks.updateProviderSettings.mock.calls[0][0].body.llm_providers[0].name,
    ).toBe("Edited provider");
    expect(
      mocks.updateModel.mock.calls.map(([request]) => [
        request.path.model_id,
        request.body.context_window,
      ]),
    ).toEqual([
      ["first-model", 4096],
      ["second-model", 8192],
    ]);
  });

  it("retains model edits after a failed save and retries from the main button", async () => {
    mocks.listModels.mockResolvedValue({
      models: [
        {
          id: "retry-model",
          name: "Retry model",
          provider_id: settings.llm_providers![0].id,
          is_active: true,
          context_window: null,
        },
      ],
      total: 1,
    });
    mocks.updateModel
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({});
    render(<ProvidersTab appSettings={settings} />, { wrapper: Wrapper });
    fireEvent.click(
      screen.getByRole("button", { name: "Browse 1,000 models" }),
    );
    await screen.findByText("Retry model");
    fireEvent.change(screen.getByLabelText("Context window"), {
      target: { value: "4096" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
    );
    expect(mocks.updateProviderSettings).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Context window")).toHaveValue(4096);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.updateProviderSettings).toHaveBeenCalledTimes(1),
    );
    expect(mocks.updateModel).toHaveBeenCalledTimes(2);
  });

  it("clears a staged draft selection when the model is disabled", async () => {
    mocks.listModels.mockResolvedValue({
      models: [
        {
          id: "draft-model",
          name: "Draft candidate",
          provider_id: settings.llm_providers![0].id,
          is_active: true,
          context_window: null,
        },
      ],
      total: 1,
    });
    mocks.updateModel.mockResolvedValue({});
    render(<ProvidersTab appSettings={settings} />, { wrapper: Wrapper });
    fireEvent.click(
      screen.getByRole("button", { name: "Browse 1,000 models" }),
    );
    await screen.findByText("Draft candidate");
    fireEvent.click(screen.getByRole("button", { name: "Set draft" }));
    expect(mocks.updateProviderSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Draft candidate"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.updateProviderSettings).toHaveBeenCalledTimes(1),
    );
    expect(
      mocks.updateProviderSettings.mock.calls[0][0].body.draft_model_id,
    ).toBeNull();
  });

  it("validates context windows on a hidden catalog before sending any updates", async () => {
    mocks.listModels.mockResolvedValue({
      models: [
        {
          id: "invalid-model",
          name: "Invalid candidate",
          provider_id: settings.llm_providers![0].id,
          is_active: true,
          context_window: null,
        },
      ],
      total: 1,
    });
    render(<ProvidersTab appSettings={settings} />, { wrapper: Wrapper });
    fireEvent.click(
      screen.getByRole("button", { name: "Browse 1,000 models" }),
    );
    await screen.findByText("Invalid candidate");
    fireEvent.change(screen.getByLabelText("Context window"), {
      target: { value: "-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hide models" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
    );
    expect(mocks.updateModel).not.toHaveBeenCalled();
    expect(mocks.updateProviderSettings).not.toHaveBeenCalled();
  });

  it("clears the draft model when its provider is removed", async () => {
    const draftProviderId = "20000000-0000-4000-8000-000000000001";
    const retainedProviderId = "20000000-0000-4000-8000-000000000002";
    const draftModelId = "30000000-0000-4000-8000-000000000001";
    const provider = { ...settings.llm_providers![0], api_key: "secret" };
    mocks.updateProviderSettings.mockResolvedValue({});
    render(
      <ProvidersTab
        appSettings={{
          draft_model_id: draftModelId,
          draft_model: {
            id: draftModelId,
            name: "Draft",
            provider_id: draftProviderId,
            provider_name: "Draft provider",
            context_window: null,
            supports_vision: null,
            context_window_source: "unknown",
            vision_source: "unknown",
          },
          llm_providers: [
            { ...provider, id: draftProviderId },
            {
              ...provider,
              id: retainedProviderId,
              name: "Retained provider",
            },
          ],
        }}
      />,
      { wrapper: Wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete provider 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.updateProviderSettings.mock.calls[0]?.[0]).toEqual({
        body: {
          draft_model_id: null,
          llm_providers: [expect.objectContaining({ id: retainedProviderId })],
        },
      }),
    );
  });

  it("validates OpenAI's canonical URL", () => {
    expect(
      providerSchema.safeParse({
        id: crypto.randomUUID(),
        name: "OpenAI",
        api_key: "secret",
        provider_type: "openai",
        base_url: OPENAI_BASE_URL,
      }).success,
    ).toBe(true);
    expect(
      providerSchema.safeParse({
        id: crypto.randomUUID(),
        name: "OpenAI",
        api_key: "secret",
        provider_type: "openai",
        base_url: "https://example.test/v1",
      }).success,
    ).toBe(false);
  });

  it("opens and loads the provider selected by the URL without a click", async () => {
    mocks.getSearchParam.mockImplementation((name: string) =>
      name === "provider" ? settings.llm_providers![0].id : undefined,
    );
    mocks.listModels.mockResolvedValue({
      models: [
        {
          id: "30000000-0000-4000-8000-000000000001",
          name: "URL-selected model",
          provider_id: settings.llm_providers![0].id,
          is_active: true,
          context_window: null,
          supports_vision: null,
          context_window_source: "unknown",
          vision_source: "unknown",
        },
      ],
      total: 1,
      next_cursor: null,
    });
    render(<ProvidersTab appSettings={settings} />, { wrapper: Wrapper });
    expect(screen.getByLabelText("Search Large catalog models")).toBeVisible();
    expect(await screen.findByText("URL-selected model")).toBeVisible();
    expect(mocks.listModels).toHaveBeenCalledTimes(1);
  });

  it("defers a large catalog until the administrator opens it", () => {
    render(<ProvidersTab appSettings={settings} />, { wrapper: Wrapper });
    expect(
      screen.getByRole("button", { name: "Browse 1,000 models" }),
    ).toBeVisible();
    expect(
      screen.queryByLabelText("Search Large catalog models"),
    ).not.toBeInTheDocument();
  });
});
