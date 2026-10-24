import {
  ApiClient,
  type PersonaCollection,
  type PersonaProfile,
} from "@/lib/client";
import { defaultPersonas } from "@/test/personas";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { handleMutationSuccess } from "@/lib/mutation-cache";
import { PersonaSettings } from "./persona-settings";

const { identity, api } = vi.hoisted(() => ({
  identity: { id: "a" },
  api: {
    userPersonaList: vi.fn(),
    userPersonaCreate: vi.fn(),
    userPersonaUpdate: vi.fn(),
    userPersonaDelete: vi.fn(),
    userPersonaSetDefault: vi.fn(),
    mainAgentUpdate: vi.fn(),
  },
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => identity,
}));
vi.mock("@/lib/api", () => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
}));
let data: PersonaCollection;
const extra: PersonaProfile = {
  ...defaultPersonas.profiles[0],
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Teaching",
  user_md: "Saved teaching preferences",
  is_default: false,
};

beforeEach(() => {
  identity.id = "a";
  Object.values(api).forEach((fn) => fn.mockReset());
  data = structuredClone(defaultPersonas);
  ApiClient.__registry.set(api as never);
  api.userPersonaList.mockImplementation(async () => ({
    data: structuredClone(data),
  }));
  api.userPersonaCreate.mockImplementation(async ({ body }) => {
    const result = { ...extra, ...body };
    data.profiles.push(result);
    return { data: structuredClone(result) };
  });
  api.userPersonaUpdate.mockImplementation(async ({ path, body }) => {
    const index = data.profiles.findIndex(
      (profile) => profile.id === path.persona_id,
    );
    data.profiles[index] = {
      ...data.profiles[index],
      name: body.name,
      user_md: body.user_md,
      revision: body.expected_revision + 1,
    };
    return { data: structuredClone(data.profiles[index]) };
  });
  api.userPersonaSetDefault.mockImplementation(async ({ body }) => {
    data.default_persona_id = body.persona_id;
    data.default_revision++;
    data.profiles.forEach((profile) => {
      profile.is_default = profile.id === body.persona_id;
    });
    return { data: structuredClone(data) };
  });
  api.userPersonaDelete.mockImplementation(async ({ path }) => {
    data.profiles = data.profiles.filter(
      (profile) => profile.id !== path.persona_id,
    );
    return { data: structuredClone(data) };
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
  const result = render(<PersonaSettings />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    ),
  });
  return { ...result, cache };
}

it("creates, saves USER.md through one revisioned action and switches the default separately", async () => {
  const user = userEvent.setup();
  setup();
  await screen.findByRole("button", { name: "Edit persona Default" });
  await user.type(screen.getByLabelText("New persona name"), "Teaching");
  await user.click(screen.getByRole("button", { name: "Create persona" }));
  const document = await screen.findByLabelText("USER.md instructions");
  await user.type(document, "Use clear examples.");
  expect(screen.getByRole("button", { name: "Make default" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Save persona" }));
  await waitFor(() => expect(api.userPersonaUpdate).toHaveBeenCalledOnce());
  expect(api.userPersonaUpdate.mock.calls[0][0]).toMatchObject({
    path: { persona_id: extra.id },
    body: {
      name: "Teaching",
      user_md: "Use clear examples.",
      expected_revision: 1,
    },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Make default" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Make default" }));
  await screen.findByText("Default persona", { exact: true });
  expect(api.userPersonaSetDefault.mock.calls[0][0]).toMatchObject({
    body: { persona_id: extra.id, expected_default_revision: 1 },
  });
  expect(screen.getByRole("button", { name: "Delete persona" })).toBeDisabled();
  expect(api.mainAgentUpdate).not.toHaveBeenCalled();
});

it("retains a draft on revision conflict and failed reload, then explicitly reloads saved content", async () => {
  data.profiles.push(structuredClone(extra));
  const user = userEvent.setup();
  setup();
  await user.click(
    await screen.findByRole("button", { name: "Edit persona Teaching" }),
  );
  const document = screen.getByLabelText("USER.md instructions");
  await user.clear(document);
  await user.type(document, "My unsaved draft");
  api.userPersonaUpdate.mockRejectedValueOnce({
    detail: "Persona changed; reload and retry",
  });
  await user.click(screen.getByRole("button", { name: "Save persona" }));
  await screen.findByText(/Persona changed; reload and retry/);
  expect(document).toHaveValue("My unsaved draft");
  api.userPersonaList.mockRejectedValueOnce({ detail: "Offline" });
  await user.click(
    screen.getByRole("button", { name: "Reload saved persona" }),
  );
  await screen.findByText(
    "Could not refresh personas. Your draft is retained.",
  );
  expect(document).toHaveValue("My unsaved draft");
  data.profiles[1] = { ...extra, revision: 2, user_md: "Saved by another tab" };
  await user.click(
    screen.getByRole("button", { name: "Reload saved persona" }),
  );
  await waitFor(() => expect(document).toHaveValue("Saved by another tab"));
  await user.clear(document);
  await user.type(document, "Merged changes");
  await user.click(screen.getByRole("button", { name: "Save persona" }));
  await waitFor(() => expect(api.userPersonaUpdate).toHaveBeenCalledTimes(2));
  expect(api.userPersonaUpdate.mock.calls[1][0].body.expected_revision).toBe(2);
});

it("requires delete confirmation and returns focus to creation after deletion", async () => {
  data.profiles.push(structuredClone(extra));
  const user = userEvent.setup();
  setup();
  await user.click(
    await screen.findByRole("button", { name: "Edit persona Teaching" }),
  );
  await user.click(screen.getByRole("button", { name: "Delete persona" }));
  await screen.findByRole("alertdialog");
  await user.keyboard("{Escape}");
  expect(api.userPersonaDelete).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Delete persona" }),
    ).toHaveFocus(),
  );
  await user.click(screen.getByRole("button", { name: "Delete persona" }));
  const dialog = await screen.findByRole("alertdialog");
  const { within } = await import("@testing-library/react");
  await user.click(
    within(dialog).getByRole("button", { name: "Delete persona" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByLabelText("USER.md instructions"),
    ).not.toBeInTheDocument(),
  );
  expect(api.userPersonaDelete.mock.calls[0][0]).toMatchObject({
    query: { expected_revision: 1 },
  });
  await waitFor(() =>
    expect(screen.getByLabelText("New persona name")).toHaveFocus(),
  );
});

it("handles initial loading failure and retries without inventing a profile", async () => {
  api.userPersonaList.mockRejectedValueOnce({ detail: "Network unavailable" });
  const user = userEvent.setup();
  setup();
  await screen.findByText("Could not load personas.");
  expect(screen.queryByLabelText("New persona name")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("button", { name: "Edit persona Default" });
  expect(api.userPersonaCreate).not.toHaveBeenCalled();
});

it("keeps a local draft when cached refresh fails", async () => {
  data.profiles.push(structuredClone(extra));
  const user = userEvent.setup();
  const { cache } = setup();
  await user.click(
    await screen.findByRole("button", { name: "Edit persona Teaching" }),
  );
  await user.type(
    screen.getByLabelText("USER.md instructions"),
    " Local change",
  );
  api.userPersonaList.mockRejectedValueOnce({ detail: "Refresh failed" });
  await act(async () => {
    await cache.invalidateQueries();
  });
  await screen.findByText(
    "Could not refresh personas. Your draft is retained.",
  );
  expect(screen.getByLabelText("USER.md instructions")).toHaveValue(
    "Saved teaching preferences Local change",
  );
});

it("discards the previous owner's editor state and cache view when the authenticated owner changes", async () => {
  const user = userEvent.setup();
  const { rerender } = setup();
  await user.click(
    await screen.findByRole("button", { name: "Edit persona Default" }),
  );
  await user.type(
    screen.getByLabelText("USER.md instructions"),
    "Private owner A draft",
  );
  identity.id = "b";
  data = {
    ...structuredClone(defaultPersonas),
    default_persona_id: extra.id,
    profiles: [
      { ...defaultPersonas.profiles[0], id: extra.id, name: "Owner B" },
    ],
  };
  rerender(<PersonaSettings />);
  expect(
    screen.queryByLabelText("USER.md instructions"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByDisplayValue("Private owner A draft"),
  ).not.toBeInTheDocument();
  await screen.findByRole("button", { name: "Edit persona Owner B" });
  expect(
    screen.queryByRole("button", { name: "Edit persona Default" }),
  ).not.toBeInTheDocument();
});

it("enforces the profile count and document character bound in the form", async () => {
  data.profiles = [
    ...defaultPersonas.profiles,
    ...Array.from({ length: 19 }, (_, index) => ({
      ...extra,
      id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`,
      name: `Persona ${index}`,
    })),
  ];
  const user = userEvent.setup();
  setup();
  await user.click(
    await screen.findByRole("button", { name: "Edit persona Persona 0" }),
  );
  expect(screen.getByLabelText("New persona name")).toBeDisabled();
  const { fireEvent } = await import("@testing-library/react");
  fireEvent.change(screen.getByLabelText("USER.md instructions"), {
    target: { value: "x".repeat(16001) },
  });
  expect(screen.getByRole("button", { name: "Save persona" })).toBeDisabled();
  expect(
    screen.getByText("USER.md must contain at most 16,000 characters."),
  ).toBeVisible();
});
