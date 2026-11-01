import {
  ApiClient,
  type Chat,
  type ChatInfo,
  type LearningModeCatalog,
  type LearningModeId,
} from "@/lib/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ExistingChatLearningModePicker,
  LearningModePicker,
} from "./chat-learning-mode-picker";

const { api, changed } = vi.hoisted(() => ({
  api: {
    learningModeGetMany: vi.fn(),
    chatLearningModeUpdate: vi.fn(),
    chatSessionGetOne: vi.fn(),
  },
  changed: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
}));

const catalog: LearningModeCatalog = {
  modes: [
    {
      id: "standard",
      name: "Standard",
      description: "Answers directly.",
      version: 1,
    },
    { id: "tutor", name: "Tutor", description: "Guides you.", version: 1 },
    {
      id: "explain_back",
      name: "Explain-back",
      description: "You explain.",
      version: 1,
    },
    {
      id: "review",
      name: "Review my work",
      description: "Feedback on your attempt.",
      version: 1,
    },
  ],
};

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  changed.mockReset();
  ApiClient.__registry.set(api as never);
  api.learningModeGetMany.mockResolvedValue({ data: catalog });
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(element: React.ReactNode) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cache}>{element}</QueryClientProvider>,
  );
}

function Controlled() {
  const [value, setValue] = useState<LearningModeId>("standard");
  return (
    <LearningModePicker
      value={value}
      onChange={(next) => {
        setValue(next);
        changed(next);
      }}
    />
  );
}

it("offers the four modes with their descriptions", async () => {
  const user = userEvent.setup();
  setup(<Controlled />);
  const selector = await screen.findByRole("combobox", {
    name: "Learning mode",
  });
  await waitFor(() => expect(selector).toBeEnabled());
  expect(selector).toHaveTextContent("Standard");
  await user.click(selector);
  const options = await screen.findAllByRole("option");
  const names = options.map(
    (option) =>
      document.getElementById(option.getAttribute("aria-labelledby") ?? "")
        ?.textContent,
  );
  expect(names).toEqual([
    "Standard",
    "Tutor",
    "Explain-back",
    "Review my work",
  ]);
  // Each mode explains itself in the list, not only on hover.
  expect(options[1]).toHaveAccessibleDescription("Guides you.");
  expect(options[1]).toHaveTextContent("Guides you.");
  await user.click(screen.getByRole("option", { name: "Tutor" }));
  expect(changed).toHaveBeenLastCalledWith("tutor");
  expect(selector).toHaveTextContent("Tutor");
});

it("stays disabled until the catalog loads and offers a retry on failure", async () => {
  api.learningModeGetMany.mockRejectedValueOnce({ detail: "Offline" });
  const user = userEvent.setup();
  setup(<Controlled />);
  expect(
    screen.getByRole("combobox", { name: "Learning mode" }),
  ).toBeDisabled();
  await screen.findByText("Could not load learning modes.");
  await user.click(screen.getByRole("button", { name: "Retry modes" }));
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Learning mode" }),
    ).toBeEnabled(),
  );
});

it("changes an existing chat's mode with its selection revision and recovers from a conflict", async () => {
  const info: ChatInfo = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    user_id: "a",
    created_at: 0,
    updated_at: 0,
    learning_mode: "standard",
    learning_mode_revision: 3,
  };
  const current: Chat = {
    info: { ...info, learning_mode: "review", learning_mode_revision: 4 },
    messages: [],
  };
  api.chatLearningModeUpdate.mockRejectedValueOnce({ detail: "Changed" });
  api.chatSessionGetOne.mockResolvedValueOnce({ data: current });
  function Harness() {
    const [selection, setSelection] = useState(info);
    return (
      <ExistingChatLearningModePicker
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
    name: "Learning mode",
  });
  await waitFor(() => expect(selector).toBeEnabled());
  await user.click(selector);
  await user.click(await screen.findByRole("option", { name: "Tutor" }));
  expect(api.chatLearningModeUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      path: { chat_id: info.id },
      body: { learning_mode: "tutor", expected_learning_mode_revision: 3 },
    }),
  );
  await screen.findByText(/Could not change the learning mode/);
  expect(selector).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Reload current mode" }));
  await waitFor(() => expect(changed).toHaveBeenCalledWith(current.info));
  await waitFor(() => expect(selector).toHaveTextContent("Review my work"));
  expect(screen.queryByText(/Could not change/)).toBeNull();
});

function LockedHarness({ info }: { info: ChatInfo }) {
  return (
    <ExistingChatLearningModePicker
      info={info}
      disabled={false}
      onPendingChange={() => {}}
      onSelected={changed}
    />
  );
}

const lockedTutor: ChatInfo = {
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  user_id: "a",
  created_at: 0,
  updated_at: 0,
  learning_mode: "tutor",
  learning_mode_revision: 2,
  learning_mode_locked: true,
};

it("switches a locked chat between learning modes without a confirmation", async () => {
  api.chatLearningModeUpdate.mockResolvedValueOnce({
    data: {
      ...lockedTutor,
      learning_mode: "review",
      learning_mode_revision: 3,
    },
  });
  const user = userEvent.setup();
  setup(<LockedHarness info={lockedTutor} />);
  const selector = await screen.findByRole("combobox", {
    name: "Learning mode",
  });
  await waitFor(() => expect(selector).toBeEnabled());
  await user.click(selector);
  await user.click(
    await screen.findByRole("option", { name: "Review my work" }),
  );
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(api.chatLearningModeUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      body: { learning_mode: "review", expected_learning_mode_revision: 2 },
    }),
  );
});

it("makes a locked chat wait and confirm before switching to Standard", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  api.chatLearningModeUpdate.mockResolvedValueOnce({
    data: {
      ...lockedTutor,
      learning_mode: "standard",
      learning_mode_locked: false,
      learning_mode_revision: 3,
    },
  });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  setup(<LockedHarness info={lockedTutor} />);
  const selector = await screen.findByRole("combobox", {
    name: "Learning mode",
  });
  await waitFor(() => expect(selector).toBeEnabled());
  await user.click(selector);
  await user.click(await screen.findByRole("option", { name: "Standard" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent("Leave Tutor mode?");
  await user.click(screen.getByRole("button", { name: "Stay in Tutor" }));
  expect(api.chatLearningModeUpdate).not.toHaveBeenCalled();
  expect(selector).toHaveTextContent("Tutor");

  await user.click(selector);
  await user.click(await screen.findByRole("option", { name: "Standard" }));
  const confirm = await screen.findByRole("button", {
    name: "Switch to Standard",
  });
  expect(confirm).toBeDisabled();
  act(() => vi.advanceTimersByTime(5000));
  expect(confirm).toBeEnabled();
  await user.click(confirm);
  await waitFor(() =>
    expect(api.chatLearningModeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          learning_mode: "standard",
          expected_learning_mode_revision: 2,
          override_lock: true,
        },
      }),
    ),
  );
  await waitFor(() =>
    expect(changed.mock.calls[0]?.[0]).toMatchObject({
      learning_mode: "standard",
      learning_mode_locked: false,
    }),
  );
});
