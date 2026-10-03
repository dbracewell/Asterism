import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderSettings } from "@/lib/client";
import { OPENAI_BASE_URL, providerSchema, ProvidersTab } from "./providers-tab";

const mocks = vi.hoisted(() => ({
  listModels: vi.fn(),
  getSearchParam: vi.fn(),
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
    },
  ],
};

vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  appProviderModelsDiscoverAndSyncMutation: () => ({ mutationFn: vi.fn() }),
  appProviderModelsListOptions: () => ({
    queryKey: ["appProviderModelsList"],
    queryFn: mocks.listModels,
  }),
  appProviderModelUpdateMutation: () => ({ mutationFn: mocks.updateModel }),
  appProviderSettingsGetOptions: () => ({
    queryKey: ["appProviderSettingsGet"],
    queryFn: () => Promise.resolve(settings),
  }),
  appProviderSettingsGetQueryKey: () => ["appProviderSettingsGet"],
  appProviderSettingsUpdateMutation: () => ({
    mutationFn: mocks.updateProviderSettings,
  }),
}));

vi.mock("@/hooks/use-read-write-search-params", () => ({
  useReadWriteSearchParams: () => ({
    getSearchParam: mocks.getSearchParam,
    setSearchParams: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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

describe("provider model browser", () => {
  beforeEach(() => {
    mocks.getSearchParam.mockReset();
    mocks.listModels.mockReset();
    mocks.listModels.mockResolvedValue({ models: [], total: 0 });
    mocks.updateModel.mockReset();
    mocks.updateProviderSettings.mockReset();
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
    fireEvent.click(screen.getByRole("button", { name: "Select All" }));
    await waitFor(() =>
      expect(mocks.updateModel.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          path: expect.objectContaining({
            model_id: "30000000-0000-4000-8000-000000000002",
          }),
          body: expect.objectContaining({ is_active: true }),
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Unselect All" }));
    await waitFor(() => expect(mocks.updateModel.mock.calls).toHaveLength(3));
    expect(
      mocks.updateModel.mock.calls.slice(1).map(([request]) => request),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: expect.objectContaining({ is_active: false }),
        }),
      ]),
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
