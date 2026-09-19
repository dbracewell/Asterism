import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ApplicationSettings } from "@/lib/client";
import { OPENAI_BASE_URL, providerSchema, ProvidersTab } from "./providers-tab";

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  save: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.success,
    warning: mocks.warning,
    error: mocks.error,
  },
}));

vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  appProviderModelsDiscoverMutation: () => ({ mutationFn: mocks.discover }),
  appSettingsBulkUpdateMutation: () => ({ mutationFn: mocks.save }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const settings: ApplicationSettings = {
  active_tools: [],
  draft_model_id: "10000000-0000-4000-8000-000000000001",
  llm_providers: [
    {
      id: "20000000-0000-4000-8000-000000000001",
      name: "Local",
      provider_type: "generic_openai",
      base_url: "http://localhost:8080/v1",
      api_key: "secret",
      models: [
        {
          id: "10000000-0000-4000-8000-000000000001",
          provider_id: "20000000-0000-4000-8000-000000000001",
          name: "local-model",
          is_active: true,
          context_window: 8192,
          supports_vision: null,
          context_window_source: "provider",
          vision_source: "unknown",
        },
      ],
    },
  ],
};

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

function renderProviders(appSettings: ApplicationSettings = settings) {
  return render(<ProvidersTab appSettings={appSettings} />, {
    wrapper: Wrapper,
  });
}

describe("provider configuration", () => {
  it("validates provider-type-specific base URLs", () => {
    const base = {
      id: crypto.randomUUID(),
      name: "Provider",
      api_key: "secret",
      models: [],
    };

    expect(
      providerSchema.safeParse({
        ...base,
        provider_type: "openai",
        base_url: OPENAI_BASE_URL,
      }).success,
    ).toBe(true);
    expect(
      providerSchema.safeParse({
        ...base,
        provider_type: "openai",
        base_url: "https://example.test/v1",
      }).success,
    ).toBe(false);
    expect(
      providerSchema.safeParse({
        ...base,
        provider_type: "generic_openai",
        base_url: "http://localhost:8080/v1",
      }).success,
    ).toBe(true);
    expect(
      providerSchema.safeParse({
        ...base,
        provider_type: "generic_openai",
        base_url: "ftp://user:password@example.test/models?token=secret",
      }).success,
    ).toBe(false);
  });

  it("saves a provider without models using a null draft model", async () => {
    const user = userEvent.setup();
    mocks.save.mockResolvedValueOnce({});
    renderProviders({
      active_tools: [],
      llm_providers: [
        {
          ...settings.llm_providers![0],
          models: [],
        },
      ],
      draft_model_id: null,
    });

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          values: expect.objectContaining({ draft_model_id: null }),
        }),
      }),
      expect.anything(),
    );
  });

  it("switches provider type accessibly and enforces the fixed OpenAI URL", async () => {
    const user = userEvent.setup();
    renderProviders();

    const providerType = screen.getByLabelText("Provider type for provider 1");
    const baseUrl = screen.getByLabelText("Base URL");
    expect(baseUrl).not.toHaveAttribute("readonly");

    providerType.focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("option", { name: "OpenAI" }));

    expect(baseUrl).toHaveValue(OPENAI_BASE_URL);
    expect(baseUrl).toHaveAttribute("readonly");

    providerType.focus();
    await user.keyboard("{Enter}");
    await user.click(
      await screen.findByRole("option", { name: "Generic OpenAI" }),
    );
    expect(baseUrl).toHaveValue("");
    expect(baseUrl).not.toHaveAttribute("readonly");
    expect(screen.getByLabelText("Context window")).toHaveValue(8192);
    expect(screen.getByText("Source: provider")).toBeVisible();
  });

  it("shows tri-state capabilities and marks administrator edits manual", async () => {
    const user = userEvent.setup();
    renderProviders();

    expect(screen.getByText("Source: provider")).toBeVisible();
    expect(screen.getByText("Source: unknown")).toBeVisible();

    const context = screen.getByLabelText("Context window");
    await user.clear(context);
    await user.type(context, "16384");
    expect(screen.getByText("Source: manual")).toBeVisible();

    const vision = screen.getByLabelText("Vision input");
    expect(vision).toHaveTextContent("Unknown");
    vision.focus();
    await user.keyboard("{Enter}");
    await user.click(
      await screen.findByRole("option", { name: "Not supported" }),
    );
    expect(vision).toHaveTextContent("Not supported");
    expect(screen.getAllByText("Source: manual")).toHaveLength(2);

    vision.focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("option", { name: "Unknown" }));
    expect(vision).toHaveTextContent("Unknown");
    expect(screen.getByText("Source: unknown")).toBeVisible();
  });

  it("shows actionable backend discovery failures", async () => {
    const user = userEvent.setup();
    mocks.discover.mockRejectedValueOnce({
      detail:
        "authentication_failed: Provider rejected the supplied credentials.",
    });
    renderProviders();

    await user.click(screen.getByRole("button", { name: "Load models" }));

    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        "authentication_failed: Provider rejected the supplied credentials.",
      ),
    );
  });

  it("uses backend discovery and retains returned manual metadata", async () => {
    const user = userEvent.setup();
    mocks.discover.mockResolvedValueOnce({
      models: [
        {
          ...settings.llm_providers![0].models[0],
          context_window: 12345,
          context_window_source: "manual",
        },
      ],
      warnings: ["local-model: vision support is unknown."],
    });
    renderProviders();

    await user.click(screen.getByRole("button", { name: "Load models" }));

    await waitFor(() => expect(mocks.discover).toHaveBeenCalledOnce());
    expect(mocks.discover).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          provider_type: "generic_openai",
          provider_id: settings.llm_providers![0].id,
          draft_model_id: settings.draft_model_id,
        }),
      }),
      expect.anything(),
    );
    expect(screen.getByLabelText("Context window")).toHaveValue(12345);
    expect(screen.getByText("Source: manual")).toBeVisible();
    expect(mocks.warning).toHaveBeenCalledWith(
      "1 capability fields need manual review.",
    );
  });
});
