import { ApiClient, type Chat, type ChatInfo } from "@/lib/client";
import { defaultPersonas } from "@/test/personas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  ChatPersonaPicker,
  ExistingChatPersonaPicker,
} from "./chat-persona-picker";

const { api, changed } = vi.hoisted(() => ({
  api: {
    userPersonaList: vi.fn(),
    chatPersonaUpdate: vi.fn(),
    chatSessionGetOne: vi.fn(),
  },
  changed: vi.fn(),
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ id: "a" }),
}));
vi.mock("@/lib/api", () => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
}));
const teacher = {
  ...defaultPersonas.profiles[0],
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Teaching",
  is_default: false,
};
const collection = {
  ...defaultPersonas,
  profiles: [...defaultPersonas.profiles, teacher],
};

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  changed.mockReset();
  ApiClient.__registry.set(api as never);
  api.userPersonaList.mockResolvedValue({ data: structuredClone(collection) });
});

function setup(element: React.ReactNode) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    ...render(
      <QueryClientProvider client={cache}>{element}</QueryClientProvider>,
    ),
    cache,
  };
}

function Controlled({ initial = null }: { initial?: string | null }) {
  const [value, setValue] = useState(initial);
  return (
    <ChatPersonaPicker
      value={value}
      onChange={(next) => {
        setValue(next);
        changed(next);
      }}
    />
  );
}

it("distinguishes the dynamic default choice from a fixed persona", async () => {
  const user = userEvent.setup();
  setup(<Controlled />);
  const selector = await screen.findByRole("combobox", {
    name: "Chat persona",
  });
  await waitFor(() => expect(selector).toBeEnabled());
  expect(selector).toHaveTextContent("Use my default (Default)");
  await user.click(selector);
  await user.click(await screen.findByRole("option", { name: "Teaching" }));
  expect(changed).toHaveBeenLastCalledWith(teacher.id);
  expect(selector).toHaveTextContent("Teaching");
  await user.click(selector);
  await user.click(
    await screen.findByRole("option", { name: "Use my default (Default)" }),
  );
  expect(changed).toHaveBeenLastCalledWith(null);
});

it("retains an unavailable saved identity without selecting the first available profile", async () => {
  const unavailable = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  setup(<Controlled initial={unavailable} />);
  await screen.findByText(
    "Selected persona is unavailable. Choose an available persona.",
  );
  expect(
    screen.getByRole("combobox", { name: "Chat persona" }),
  ).toHaveTextContent("Unavailable persona");
  expect(changed).not.toHaveBeenCalled();
});

it("distinguishes loading and failed loading, then retries the owned collection", async () => {
  let finish!: (result: { data: typeof collection }) => void;
  api.userPersonaList.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  setup(<Controlled />);
  expect(screen.getByRole("combobox", { name: "Chat persona" })).toBeDisabled();
  expect(screen.getByText("Loading personas…")).toBeInTheDocument();
  await act(async () => {
    finish({ data: collection });
  });
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Chat persona" }),
    ).toBeEnabled(),
  );
});

it("reports an initial failure and recovers with retry", async () => {
  api.userPersonaList.mockRejectedValueOnce({ detail: "Offline" });
  const user = userEvent.setup();
  setup(<Controlled />);
  await screen.findByText("Could not load personas.");
  expect(screen.getByRole("combobox", { name: "Chat persona" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Retry personas" }));
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Chat persona" }),
    ).toBeEnabled(),
  );
});

it("preserves cached choices through a refresh failure", async () => {
  const { cache } = setup(<Controlled initial={teacher.id} />);
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Chat persona" }),
    ).toHaveTextContent("Teaching"),
  );
  api.userPersonaList.mockRejectedValueOnce({ detail: "Refresh failed" });
  await act(async () => {
    await cache.invalidateQueries();
  });
  await screen.findByText(
    "Could not refresh personas. Showing cached choices.",
  );
  expect(
    screen.getByRole("combobox", { name: "Chat persona" }),
  ).toHaveTextContent("Teaching");
  expect(changed).not.toHaveBeenCalled();
});

it("uses the selection revision and requires a fresh chat read after a conflict", async () => {
  const info: ChatInfo = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    user_id: "a",
    created_at: 0,
    updated_at: 0,
    persona_id: null,
    persona_revision: 1,
  };
  const current: Chat = {
    info: { ...info, persona_id: teacher.id, persona_revision: 2 },
    messages: [],
  };
  api.chatPersonaUpdate.mockRejectedValueOnce({ detail: "Selection changed" });
  api.chatSessionGetOne
    .mockRejectedValueOnce({ detail: "Reload failed" })
    .mockResolvedValueOnce({ data: current });
  function Harness() {
    const [selection, setSelection] = useState(info);
    return (
      <ExistingChatPersonaPicker
        info={selection}
        disabled={false}
        onPendingChange={() => {}}
        onSelected={(next) => {
          setSelection(next);
          changed(next);
        }}
      />
    );
  }
  const user = userEvent.setup();
  setup(<Harness />);
  const selector = await screen.findByRole("combobox", {
    name: "Chat persona",
  });
  await waitFor(() => expect(selector).toBeEnabled());
  await user.click(selector);
  await user.click(await screen.findByRole("option", { name: "Teaching" }));
  await screen.findByText(/Could not change persona/);
  expect(api.chatPersonaUpdate.mock.calls[0][0]).toMatchObject({
    body: { persona_id: teacher.id, expected_persona_revision: 1 },
  });
  await user.click(
    screen.getByRole("button", { name: "Reload current persona" }),
  );
  await waitFor(() => expect(api.chatSessionGetOne).toHaveBeenCalledOnce());
  expect(changed).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Reload current persona" }),
  );
  await waitFor(() => expect(selector).toHaveTextContent("Teaching"));
  expect(changed).toHaveBeenCalledWith(current.info);
});
