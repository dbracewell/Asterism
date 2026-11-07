import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OPENAI_BASE_URL } from "@/features/settings/provider-schema";
import type { Llm, ProviderSettings } from "@/lib/client";
import { capabilityUpdate, ProviderSetupStep } from "./provider-setup-step";

const providerId = "20000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  saveProviders: vi.fn(),
  discover: vi.fn(),
  listModels: vi.fn(),
  updateModel: vi.fn(),
  updateSetting: vi.fn(),
  preview: vi.fn(),
  importSettings: vi.fn(),
  chatModels: vi.fn(),
}));

vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  appProviderSettingsGetOptions: () => ({
    queryKey: ["appProviderSettingsGet"],
    queryFn: () => mocks.settings(),
  }),
  appProviderSettingsUpdateMutation: () => ({
    mutationFn: mocks.saveProviders,
  }),
  appProviderModelsDiscoverAndSyncMutation: () => ({
    mutationFn: mocks.discover,
  }),
  appProviderModelsListOptions: ({
    query,
  }: {
    query: { query: string; cursor?: string };
  }) => ({
    queryKey: ["appProviderModelsList", query],
    queryFn: () => mocks.listModels(query),
  }),
  appProviderModelUpdateMutation: () => ({ mutationFn: mocks.updateModel }),
  userSettingUpdateMutation: () => ({ mutationFn: mocks.updateSetting }),
  appSettingsImportPreviewMutation: () => ({ mutationFn: mocks.preview }),
  appSettingsImportMutation: () => ({ mutationFn: mocks.importSettings }),
  chatModelsListOptions: () => ({
    queryKey: ["chatModels"],
    queryFn: () => mocks.chatModels(),
  }),
}));

const model = (index: number, changes: Partial<Llm> = {}): Llm => ({
  id: `30000000-0000-4000-8000-00000000000${index}`,
  name: `model-${index}`,
  provider_id: providerId,
  is_active: false,
  context_window: null,
  supports_vision: null,
  supports_tools: null,
  context_window_source: "unknown",
  tools_source: "unknown",
  vision_source: "unknown",
  ...changes,
});

const catalog = [
  model(1, { supports_tools: true, tools_source: "provider" }),
  model(2, { supports_vision: true, context_window: 8192 }),
];

const savedSettings = (modelCount: number): ProviderSettings => ({
  draft_model_id: null,
  llm_providers: [
    {
      id: providerId,
      name: "Local",
      provider_type: "generic_openai",
      base_url: "http://localhost:11434/v1",
      model_count: modelCount,
      active_model_count: 0,
      ...{ api_key: "**********" },
    },
  ],
});

function createTestQueryClient() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _context, mutation) => {
        if (!mutation.meta?.skipGlobalInvalidation)
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

const renderStep = (onStart = vi.fn()) => {
  render(<ProviderSetupStep onStart={onStart} />, { wrapper: Wrapper });
  return onStart;
};

const readyButton = () =>
  screen.findByRole("button", { name: "Start chatting" });

const steps = () => screen.getByRole("list", { name: "First-run setup" });

async function fillGenericProvider(baseUrl = "http://localhost:11434/v1") {
  const user = userEvent.setup();
  const form = await screen.findByRole("form", {
    name: "Add a model provider",
  });
  await user.click(
    within(form).getByRole("radio", { name: "OpenAI-compatible" }),
  );
  await user.type(within(form).getByLabelText("Provider name"), "Local");
  await user.type(within(form).getByLabelText("Base URL"), baseUrl);
  await user.type(within(form).getByLabelText("API key"), "local-key");
  return { user, form };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({ draft_model_id: null, llm_providers: [] });
  mocks.saveProviders.mockResolvedValue({});
  mocks.discover.mockResolvedValue({ model_count: 2 });
  mocks.listModels.mockResolvedValue({
    models: catalog,
    total: 2,
    next_cursor: null,
  });
  mocks.updateModel.mockResolvedValue({});
  mocks.updateSetting.mockResolvedValue({});
});

describe("first-run provider step", () => {
  it("marks the account complete and the provider step current", async () => {
    renderStep();
    const items = within(steps()).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("(complete)");
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[2]).not.toHaveAttribute("aria-current");
    expect(
      await screen.findByRole("form", { name: "Add a model provider" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Skip for now" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("fixes the OpenAI base URL and validates like provider settings", async () => {
    const user = userEvent.setup();
    renderStep();
    const form = await screen.findByRole("form", {
      name: "Add a model provider",
    });
    expect(within(form).getByRole("radio", { name: "OpenAI" })).toBeChecked();
    expect(within(form).getByLabelText("Base URL")).toHaveValue(
      OPENAI_BASE_URL,
    );
    expect(within(form).getByLabelText("Base URL")).toHaveAttribute("readonly");
    await user.click(
      within(form).getByRole("button", { name: "Connect and discover models" }),
    );
    expect(await within(form).findByText("API key is required.")).toBeVisible();
    await user.click(
      within(form).getByRole("radio", { name: "OpenAI-compatible" }),
    );
    expect(within(form).getByLabelText("Provider name")).toHaveValue("");
    expect(within(form).getByLabelText("Base URL")).toHaveValue("");
    await user.type(within(form).getByLabelText("Base URL"), "not a url");
    await user.click(
      within(form).getByRole("button", { name: "Connect and discover models" }),
    );
    expect(
      await within(form).findByText(
        "Base URL must be an absolute HTTP(S) URL.",
      ),
    ).toBeVisible();
    expect(within(form).getByText("Provider name is required.")).toBeVisible();
    expect(mocks.saveProviders).not.toHaveBeenCalled();
  });

  it("keeps entered values after a discovery failure and retries", async () => {
    mocks.discover.mockRejectedValueOnce({
      detail: "connectivity: Could not connect to the provider model endpoint.",
    });
    renderStep();
    const { user, form } = await fillGenericProvider();
    await user.click(
      within(form).getByRole("button", { name: "Connect and discover models" }),
    );
    const alert = await within(form).findByRole("alert");
    expect(alert).toHaveTextContent(
      "Model discovery failed. Could not connect to the provider model endpoint. Check the base URL and API key, then retry.",
    );
    expect(alert).toHaveFocus();
    expect(within(form).getByLabelText("Provider name")).toHaveValue("Local");
    expect(within(form).getByLabelText("API key")).toHaveValue("local-key");
    const saved = mocks.saveProviders.mock.calls[0][0].body;
    expect(saved.llm_providers).toEqual([
      expect.objectContaining({
        name: "Local",
        provider_type: "generic_openai",
        base_url: "http://localhost:11434/v1",
        api_key: "local-key",
      }),
    ]);

    await user.click(within(form).getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("form", { name: "Enable models" }),
    ).toBeVisible();
    // The retry updates the same provider rather than adding a second one.
    const retried = mocks.saveProviders.mock.calls[1][0].body;
    expect(retried.llm_providers).toHaveLength(1);
    expect(retried.llm_providers[0].id).toBe(saved.llm_providers[0].id);
    expect(mocks.discover).toHaveBeenLastCalledWith(
      { path: { provider_id: saved.llm_providers[0].id } },
      expect.anything(),
    );
  });

  it("reports a provider with no models instead of continuing", async () => {
    mocks.discover.mockResolvedValue({ model_count: 0 });
    renderStep();
    const { user, form } = await fillGenericProvider();
    await user.click(
      within(form).getByRole("button", { name: "Connect and discover models" }),
    );
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "The provider returned no models.",
    );
  });

  it("enables the chosen models, saves the default and shows the ready step", async () => {
    mocks.settings.mockResolvedValue(savedSettings(2));
    const onStart = renderStep();
    const user = userEvent.setup();
    const form = await screen.findByRole("form", { name: "Enable models" });
    expect(
      await within(form).findByRole("img", { name: "Tool calling" }),
    ).toBeVisible();
    expect(
      within(form).getByRole("img", { name: "Vision input" }),
    ).toBeVisible();

    await user.click(within(form).getByRole("button", { name: "Continue" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "Enable at least one model to continue.",
    );
    expect(mocks.updateModel).not.toHaveBeenCalled();

    await user.click(await within(form).findByLabelText("model-1"));
    await user.click(within(form).getByLabelText("model-2"));
    expect(within(form).getByText("2 models · 2 enabled")).toBeVisible();
    expect(within(form).getByLabelText("Default model")).toHaveTextContent(
      "model-1",
    );
    await user.click(within(form).getByLabelText("Default model"));
    await user.click(await screen.findByRole("option", { name: "model-2" }));

    await user.click(within(form).getByRole("button", { name: "Continue" }));
    const start = await readyButton();
    expect(mocks.updateModel).toHaveBeenCalledTimes(2);
    expect(mocks.updateModel.mock.calls[1][0]).toEqual({
      path: { provider_id: providerId, model_id: catalog[1].id },
      body: {
        is_active: true,
        context_window: 8192,
        supports_vision: true,
        supports_tools: null,
        tools_source: "unknown",
        context_window_source: "unknown",
        vision_source: "unknown",
      },
    });
    expect(mocks.updateSetting).toHaveBeenCalledWith(
      { path: { key: "default_model_id" }, body: { value: catalog[1].id } },
      expect.anything(),
    );
    const items = within(steps()).getAllByRole("listitem");
    expect(items[1]).toHaveTextContent("(complete)");
    expect(items[2]).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("status")).toHaveTextContent(
      "You're ready to start your exploration.",
    );
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(start).toHaveFocus();
    // The ready step waits for the administrator instead of redirecting.
    expect(onStart).not.toHaveBeenCalled();
    await user.click(start);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("keeps model choices after an enablement failure", async () => {
    mocks.settings.mockResolvedValue(savedSettings(2));
    mocks.updateModel.mockRejectedValueOnce({ detail: "Database busy" });
    renderStep();
    const user = userEvent.setup();
    const form = await screen.findByRole("form", { name: "Enable models" });
    await user.click(await within(form).findByLabelText("model-1"));
    await user.click(within(form).getByRole("button", { name: "Continue" }));
    const alert = await within(form).findByRole("alert");
    expect(alert).toHaveTextContent(
      "Your model choices could not be saved. Database busy",
    );
    expect(alert).toHaveFocus();
    expect(within(form).getByLabelText("model-1")).toBeChecked();
    expect(
      screen.queryByRole("button", { name: "Start chatting" }),
    ).not.toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Continue" }));
    expect(await readyButton()).toBeVisible();
  });

  it("saves the draft model, following the default until chosen", async () => {
    mocks.settings.mockResolvedValue(savedSettings(2));
    renderStep();
    const user = userEvent.setup();
    const form = await screen.findByRole("form", { name: "Enable models" });
    expect(
      within(form).queryByLabelText("Draft model"),
    ).not.toBeInTheDocument();
    await user.click(await within(form).findByLabelText("model-1"));
    await user.click(within(form).getByLabelText("model-2"));
    const draft = within(form).getByLabelText("Draft model");
    expect(draft).toHaveTextContent("model-1");
    expect(draft).toHaveAccessibleDescription(
      "Writes chat titles and other short background tasks for everyone. A small, fast model works best.",
    );
    // Untouched, the draft model follows the default.
    await user.click(within(form).getByLabelText("Default model"));
    await user.click(await screen.findByRole("option", { name: "model-2" }));
    expect(within(form).getByLabelText("Draft model")).toHaveTextContent(
      "model-2",
    );
    // Once chosen, it no longer follows the default.
    await user.click(within(form).getByLabelText("Draft model"));
    await user.click(await screen.findByRole("option", { name: "model-1" }));
    await user.click(within(form).getByLabelText("Default model"));
    await user.click(await screen.findByRole("option", { name: "model-2" }));
    expect(within(form).getByLabelText("Draft model")).toHaveTextContent(
      "model-1",
    );

    mocks.saveProviders.mockClear();
    await user.click(within(form).getByRole("button", { name: "Continue" }));
    await readyButton();
    expect(mocks.saveProviders).toHaveBeenCalledTimes(1);
    // The providers are re-sent unchanged; the redacted key keeps the credential.
    expect(mocks.saveProviders.mock.calls[0][0].body).toEqual({
      llm_providers: [
        expect.objectContaining({ id: providerId, api_key: "**********" }),
      ],
      draft_model_id: catalog[0].id,
    });
    // The draft must name an active model, so it is saved after enabling.
    const order = (mock: { mock: { invocationCallOrder: number[] } }) =>
      mock.mock.invocationCallOrder.at(-1) ?? 0;
    expect(order(mocks.saveProviders)).toBeGreaterThan(
      order(mocks.updateModel),
    );
    expect(order(mocks.saveProviders)).toBeGreaterThan(
      order(mocks.updateSetting),
    );
  });

  it("falls back to the default when the chosen draft model is disabled", async () => {
    mocks.settings.mockResolvedValue(savedSettings(2));
    renderStep();
    const user = userEvent.setup();
    const form = await screen.findByRole("form", { name: "Enable models" });
    await user.click(await within(form).findByLabelText("model-1"));
    await user.click(within(form).getByLabelText("model-2"));
    await user.click(within(form).getByLabelText("Draft model"));
    await user.click(await screen.findByRole("option", { name: "model-2" }));
    await user.click(within(form).getByLabelText("model-2"));
    expect(within(form).getByLabelText("Draft model")).toHaveTextContent(
      "model-1",
    );
    mocks.saveProviders.mockClear();
    await user.click(within(form).getByRole("button", { name: "Continue" }));
    await readyButton();
    expect(mocks.saveProviders.mock.calls[0][0].body.draft_model_id).toBe(
      catalog[0].id,
    );
  });

  it("keeps choices when saving the draft model fails, then retries", async () => {
    mocks.settings.mockResolvedValue(savedSettings(2));
    renderStep();
    const user = userEvent.setup();
    const form = await screen.findByRole("form", { name: "Enable models" });
    await user.click(await within(form).findByLabelText("model-1"));
    mocks.saveProviders.mockRejectedValueOnce({
      detail: "draft_model_id must reference an active model",
    });
    await user.click(within(form).getByRole("button", { name: "Continue" }));
    const alert = await within(form).findByRole("alert");
    expect(alert).toHaveTextContent(
      "Your model choices could not be saved. draft_model_id must reference an active model",
    );
    expect(alert).toHaveFocus();
    expect(within(form).getByLabelText("model-1")).toBeChecked();
    expect(within(form).getByLabelText("Draft model")).toHaveTextContent(
      "model-1",
    );
    await user.click(within(form).getByRole("button", { name: "Continue" }));
    expect(await readyButton()).toBeVisible();
    expect(mocks.saveProviders.mock.lastCall?.[0].body.draft_model_id).toBe(
      catalog[0].id,
    );
  });

  it("shows Vision and Tools choices for enabled models only", async () => {
    mocks.settings.mockResolvedValue(savedSettings(2));
    renderStep();
    const user = userEvent.setup();
    const form = await screen.findByRole("form", { name: "Enable models" });
    await within(form).findByLabelText("model-1");
    expect(
      within(form).queryByRole("checkbox", { name: "Vision for model-1" }),
    ).not.toBeInTheDocument();
    expect(
      within(form).queryByText(/Check Vision and Tools only/),
    ).not.toBeInTheDocument();

    await user.click(within(form).getByLabelText("model-1"));
    const vision = within(form).getByRole("checkbox", {
      name: "Vision for model-1",
    });
    const tools = within(form).getByRole("checkbox", {
      name: "Tools for model-1",
    });
    // Discovery reported tools; vision is unknown and marked as such.
    expect(tools).toBeChecked();
    expect(tools).not.toHaveAccessibleDescription();
    expect(vision).not.toBeChecked();
    expect(vision).toHaveAccessibleDescription("(Unknown)");
    expect(
      within(form).getByText(
        "Check Vision and Tools only for what each enabled model supports; unchecked capabilities are not used. Tools are needed for sub-agents and project file search.",
      ),
    ).toBeVisible();

    // Choosing clears the unknown marker; disabling the model drops its choices.
    await user.click(vision);
    expect(vision).toBeChecked();
    expect(vision).not.toHaveAccessibleDescription();
    await user.click(within(form).getByLabelText("model-1"));
    expect(
      within(form).queryByRole("checkbox", { name: "Vision for model-1" }),
    ).not.toBeInTheDocument();
    await user.click(within(form).getByLabelText("model-1"));
    expect(
      within(form).getByRole("checkbox", { name: "Vision for model-1" }),
    ).not.toBeChecked();
  });

  it("saves changed capabilities as manual and keeps untouched ones", async () => {
    mocks.settings.mockResolvedValue(savedSettings(2));
    renderStep();
    const user = userEvent.setup();
    const form = await screen.findByRole("form", { name: "Enable models" });
    await user.click(await within(form).findByLabelText("model-1"));
    await user.click(within(form).getByLabelText("model-2"));
    // model-1: uncheck discovered tools, check unknown vision.
    await user.click(
      within(form).getByRole("checkbox", { name: "Tools for model-1" }),
    );
    await user.click(
      within(form).getByRole("checkbox", { name: "Vision for model-1" }),
    );
    // model-2: toggling tools on and off again leaves it untouched.
    const tools2 = within(form).getByRole("checkbox", {
      name: "Tools for model-2",
    });
    await user.click(tools2);
    await user.click(tools2);
    await user.click(within(form).getByRole("button", { name: "Continue" }));
    await readyButton();
    const bodies = mocks.updateModel.mock.calls.map((call) => call[0].body);
    expect(bodies[0]).toMatchObject({
      supports_vision: true,
      vision_source: "manual",
      supports_tools: false,
      tools_source: "manual",
    });
    expect(bodies[1]).toMatchObject({
      supports_vision: true,
      vision_source: "unknown",
      supports_tools: null,
      tools_source: "unknown",
    });
  });

  it("resumes a saved provider without models at the connection form", async () => {
    mocks.settings.mockResolvedValue(savedSettings(0));
    renderStep();
    const form = await screen.findByRole("form", {
      name: "Add a model provider",
    });
    expect(within(form).getByLabelText("Provider name")).toHaveValue("Local");
    expect(
      within(form).getByRole("radio", { name: "OpenAI-compatible" }),
    ).toBeChecked();
    await userEvent.click(
      within(form).getByRole("button", { name: /Connect/ }),
    );
    await screen.findByRole("form", { name: "Enable models" });
    // The redacted key keeps the stored credential.
    expect(
      mocks.saveProviders.mock.calls[0][0].body.llm_providers[0].api_key,
    ).toBe("**********");
  });

  it("searches the discovered catalog", async () => {
    mocks.settings.mockResolvedValue(savedSettings(2));
    renderStep();
    const user = userEvent.setup();
    await screen.findByRole("form", { name: "Enable models" });
    await user.type(screen.getByLabelText("Search models"), "model-2");
    await waitFor(() =>
      expect(mocks.listModels).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: "model-2" }),
      ),
    );
  });
});

describe("capability updates", () => {
  const vision = (changes: Partial<Llm>, checked?: boolean) =>
    capabilityUpdate(
      model(9, changes),
      checked === undefined ? undefined : { vision: checked },
      "vision",
    );

  it("keeps untouched values and sources, including unknown", () => {
    expect(vision({})).toEqual({ value: null, source: "unknown" });
    expect(
      vision({ supports_vision: true, vision_source: "provider" }),
    ).toEqual({ value: true, source: "provider" });
    expect(
      vision({ supports_vision: false, vision_source: "catalog" }),
    ).toEqual({ value: false, source: "catalog" });
  });

  it("treats an unchanged choice as untouched", () => {
    expect(vision({}, false)).toEqual({ value: null, source: "unknown" });
    expect(
      vision({ supports_vision: true, vision_source: "catalog" }, true),
    ).toEqual({ value: true, source: "catalog" });
    expect(
      vision({ supports_vision: false, vision_source: "manual" }, false),
    ).toEqual({ value: false, source: "manual" });
  });

  it("saves changed choices as manual values", () => {
    expect(vision({}, true)).toEqual({ value: true, source: "manual" });
    expect(
      vision({ supports_vision: true, vision_source: "provider" }, false),
    ).toEqual({ value: false, source: "manual" });
    expect(
      vision({ supports_vision: false, vision_source: "catalog" }, true),
    ).toEqual({ value: true, source: "manual" });
  });
});

describe("import in place of provider setup", () => {
  const summary = {
    exported_at: 1_700_000_000,
    providers: [
      { name: "Local", action: "add", models_added: 2, models_updated: 0 },
    ],
    kept_providers: [],
    changed_settings: [],
  };
  const chatModel = (name: string, available = true) => ({
    id: `40000000-0000-4000-8000-${name.padStart(12, "0")}`,
    name,
    provider_name: "Local",
    available,
  });

  beforeEach(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.scrollIntoView = () => {};
    mocks.settings.mockResolvedValue({ llm_providers: [] });
    mocks.preview.mockReset().mockResolvedValue(summary);
    mocks.importSettings.mockReset().mockResolvedValue(summary);
    mocks.updateSetting.mockReset().mockResolvedValue({});
    mocks.chatModels
      .mockReset()
      .mockResolvedValue([chatModel("1"), chatModel("2", false)]);
  });

  async function importFile() {
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Import a settings file instead",
      }),
    );
    await user.upload(
      screen.getByLabelText("Settings file"),
      new File(["{}"], "settings.json", { type: "application/json" }),
    );
    await user.type(screen.getByLabelText("File passphrase"), "the passphrase");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Preview import" }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await user.click(
      await screen.findByRole("button", { name: "Import settings" }),
    );
    return user;
  }

  it("offers import and returns to the provider form", async () => {
    renderStep();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Import a settings file instead",
      }),
    );
    expect(screen.getByLabelText("Settings file")).toBeInTheDocument();
    expect(mocks.saveProviders).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Set up a provider instead" }),
    );
    expect(
      await screen.findByRole("form", { name: "Add a model provider" }),
    ).toBeVisible();
  });

  it("asks for a default model, then finishes setup", async () => {
    const onStart = renderStep();
    const user = await importFile();
    const continueButton = await screen.findByRole("button", {
      name: "Continue",
    });
    expect(continueButton).toBeDisabled();
    await user.click(screen.getByRole("combobox", { name: "Default model" }));
    expect(screen.queryByRole("option", { name: /^2 / })).toBeNull();
    await user.click(await screen.findByRole("option", { name: "1 (Local)" }));
    await user.click(continueButton);
    await user.click(await readyButton());
    expect(mocks.updateSetting.mock.calls[0][0]).toEqual({
      path: { key: "default_model_id" },
      body: { value: chatModel("1").id },
    });
    expect(onStart).toHaveBeenCalled();
    expect(mocks.saveProviders).not.toHaveBeenCalled();
  });

  it("keeps the choice and offers a retry when saving fails", async () => {
    mocks.updateSetting.mockReset().mockRejectedValue(new Error("offline"));
    renderStep();
    const user = await importFile();
    await user.click(
      await screen.findByRole("combobox", { name: "Default model" }),
    );
    await user.click(await screen.findByRole("option", { name: "1 (Local)" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Retry");
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("leads back to provider setup when the file has no active models", async () => {
    mocks.chatModels.mockReset().mockResolvedValue([chatModel("2", false)]);
    renderStep();
    const user = await importFile();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "no active models",
    );
    await user.click(screen.getByRole("button", { name: "Set up a provider" }));
    expect(
      await screen.findByRole("form", { name: "Add a model provider" }),
    ).toBeVisible();
  });

  it("stays on import when the file cannot be opened", async () => {
    mocks.preview.mockReset().mockRejectedValue({ detail: "Could not open" });
    renderStep();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Import a settings file instead",
      }),
    );
    await user.upload(
      screen.getByLabelText("Settings file"),
      new File(["{}"], "settings.json", { type: "application/json" }),
    );
    await user.type(screen.getByLabelText("File passphrase"), "wrong");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Preview import" }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not open",
    );
    expect(mocks.chatModels).not.toHaveBeenCalled();
  });
});
