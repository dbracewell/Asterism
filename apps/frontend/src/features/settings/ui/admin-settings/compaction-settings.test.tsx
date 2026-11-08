import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CompactionSettingsPane,
  parseCompactionDraft,
} from "./compaction-settings";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  role: "admin",
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ id: "admin", role: mocks.role }),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  appCompactionGetOptions: () => ({
    queryKey: [{ _id: "compaction" }],
    queryFn: () => mocks.get(),
  }),
  appCompactionGetQueryKey: () => [{ _id: "compaction" }],
  appCompactionUpdateMutation: () => ({ mutationFn: mocks.save }),
}));

const defaults = {
  threshold: 0.8,
  tail_turns: 3,
  fallback_context_window: 32768,
  model_id: null,
};

function setup() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <CompactionSettingsPane />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.role = "admin";
  mocks.get.mockReset().mockResolvedValue({ settings: defaults, models: [] });
  mocks.save.mockReset().mockImplementation(async ({ body }) => {
    const saved = { settings: body, models: [] };
    mocks.get.mockResolvedValue(saved);
    return saved;
  });
});

describe("parseCompactionDraft", () => {
  const draft = {
    threshold: "80",
    tailTurns: "3",
    fallbackWindow: "32768",
    modelId: "chat-model",
  };
  it("converts the percentage and the chat-model choice", () => {
    expect(parseCompactionDraft({ ...draft, threshold: "65" })).toEqual({
      settings: { ...defaults, threshold: 0.65 },
    });
    expect(parseCompactionDraft({ ...draft, modelId: "m1" })).toEqual({
      settings: { ...defaults, model_id: "m1" },
    });
  });
  it("rejects values outside the allowed ranges", () => {
    for (const bad of [
      { threshold: "96" },
      { threshold: "4.5" },
      { tailTurns: "0" },
      { fallbackWindow: "1000" },
      { fallbackWindow: "abc" },
    ])
      expect(parseCompactionDraft({ ...draft, ...bad })).toHaveProperty(
        "error",
      );
  });
});

it("saves edited settings", async () => {
  const user = userEvent.setup();
  setup();
  const threshold = await screen.findByLabelText(
    "Compact at (% of the context window)",
  );
  expect(threshold).toHaveValue("80");
  const save = screen.getByRole("button", { name: "Save compaction settings" });
  expect(save).toBeDisabled();

  await user.clear(threshold);
  await user.type(threshold, "99");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Compact at must be between 50% and 95%.",
  );
  expect(save).toBeDisabled();

  await user.clear(threshold);
  await user.type(threshold, "70");
  await user.clear(screen.getByLabelText("Recent turns kept in full"));
  await user.type(screen.getByLabelText("Recent turns kept in full"), "2");
  await user.click(save);
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Context compaction settings saved.",
    ),
  );
  expect(mocks.save).toHaveBeenCalledWith(
    { body: { ...defaults, threshold: 0.7, tail_turns: 2 } },
    expect.anything(),
  );
});

it("requires administrator access", () => {
  mocks.role = "user";
  setup();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Administrator access is required",
  );
});
