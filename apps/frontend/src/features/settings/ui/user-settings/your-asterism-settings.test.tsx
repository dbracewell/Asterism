import { ApiClient, type AboutYou, type MyUsage } from "@/lib/client";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { handleMutationSuccess } from "@/lib/mutation-cache";
import { YourAsterismSettings } from "./your-asterism-settings";

const { identity, api } = vi.hoisted(() => ({
  identity: { id: "a" },
  api: {
    userAboutGet: vi.fn(),
    userAboutUpdate: vi.fn(),
    usageGetMine: vi.fn(),
  },
}));
// The memory sections have their own tests (US-93.3).
vi.mock("@/features/memory/components/memory-sections", () => ({
  YourMemorySection: () => null,
  ProjectMemorySection: () => null,
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => identity,
}));
vi.mock("@/lib/api", () => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
}));

let stored: AboutYou;

// 2026-11-19 00:00 UTC.
const RESETS = 1795046400;

function usage(over: Partial<MyUsage> = {}): MyUsage {
  return {
    timezone: "UTC",
    exempt: false,
    day: {
      used_tokens: 1500,
      budget_tokens: 2000,
      remaining_tokens: 500,
      starts_at: RESETS - 86400,
      resets_at: RESETS,
    },
    month: {
      used_tokens: 1500,
      budget_tokens: null,
      remaining_tokens: null,
      starts_at: 0,
      resets_at: RESETS + 86400 * 12,
    },
    month_by_model: [],
    ...over,
  };
}

beforeEach(() => {
  identity.id = "a";
  Object.values(api).forEach((fn) => fn.mockReset());
  stored = { about_md: "", revision: 1 };
  ApiClient.__registry.set(api as never);
  api.userAboutGet.mockImplementation(async () => ({
    data: structuredClone(stored),
  }));
  api.usageGetMine.mockImplementation(async () => ({ data: usage() }));
  api.userAboutUpdate.mockImplementation(async ({ body }) => {
    if (body.expected_revision !== stored.revision) {
      throw { detail: "About you changed; reload and retry" };
    }
    stored = { about_md: body.about_md, revision: stored.revision + 1 };
    return { data: structuredClone(stored) };
  });
});

function setup() {
  const cache: QueryClient = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _context, mutation) =>
        handleMutationSuccess(cache, mutation),
    }),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(<YourAsterismSettings />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    ),
  });
  return cache;
}

const label = "What should Asterism know about you?";

it("saves About you with the expected revision", async () => {
  const user = userEvent.setup();
  setup();
  const text = await screen.findByLabelText(label);
  expect(screen.getByText("Nothing saved yet")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await user.type(text, "I study nursing.");
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  expect(screen.getByText(/16 \/ 16,000 characters/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.userAboutUpdate).toHaveBeenCalledOnce());
  expect(api.userAboutUpdate.mock.calls[0][0]).toMatchObject({
    body: { about_md: "I study nursing.", expected_revision: 1 },
  });
  await screen.findByText("Saved");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  // A second save sends the new revision.
  await user.type(text, " I know chemistry.");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.userAboutUpdate).toHaveBeenCalledTimes(2));
  expect(api.userAboutUpdate.mock.calls[1][0].body.expected_revision).toBe(2);
});

it("keeps the draft on a revision conflict and reloads the saved text on request", async () => {
  const user = userEvent.setup();
  setup();
  const text = await screen.findByLabelText(label);
  // Another tab saves first.
  stored = { about_md: "Saved elsewhere", revision: 2 };
  await user.type(text, "My draft");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText(/Could not save About you/);
  expect(text).toHaveValue("My draft");
  await user.click(screen.getByRole("button", { name: "Reload saved text" }));
  await waitFor(() => expect(text).toHaveValue("Saved elsewhere"));
  expect(
    screen.queryByText(/Could not save About you/),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

it("blocks saving text over the character limit", async () => {
  const user = userEvent.setup();
  setup();
  const text = await screen.findByLabelText(label);
  await user.click(text);
  await user.paste("x".repeat(16001));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "About you can be at most 16,000 characters.",
  );
  expect(text).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

it("does not reuse another owner's cached text", async () => {
  stored = { about_md: "Owner a", revision: 2 };
  const cache = setup();
  await waitFor(() =>
    expect(screen.getByLabelText(label)).toHaveValue("Owner a"),
  );
  const keys = cache
    .getQueryCache()
    .getAll()
    .map((query) => JSON.stringify(query.queryKey));
  expect(keys.some((key) => key.includes("userAboutGet:a"))).toBe(true);
});

it("shows today's budget, what is left and when it resets", async () => {
  setup();
  const today = await screen.findByRole("region", { name: "Today" });
  expect(today).toHaveTextContent("1,500 tokens of 2,000 tokens");
  expect(today).toHaveTextContent("500 tokens left · resets");
  expect(
    screen.getByRole("progressbar", { name: "Today: 75% of your budget used" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "This month" })).toHaveTextContent(
    "1,500 tokens used. No budget.",
  );
});

it("says when a used-up budget lets new work start again", async () => {
  api.usageGetMine.mockImplementation(async () => ({
    data: usage({
      day: {
        used_tokens: 2000,
        budget_tokens: 2000,
        remaining_tokens: 0,
        starts_at: RESETS - 86400,
        resets_at: RESETS,
      },
    }),
  }));
  setup();
  const today = await screen.findByRole("region", { name: "Today" });
  expect(today).toHaveTextContent(
    /Used up\. New work can start again .*Nov 19/,
  );
});
