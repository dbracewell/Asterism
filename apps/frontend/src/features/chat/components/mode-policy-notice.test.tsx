import {
  ApiClient,
  type ChatInfo,
  type LearningModeCatalog,
  type ModePolicy,
  type ModePolicySource,
} from "@/lib/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  ModePolicyControl,
  ModePolicyNotice,
  modeSelectable,
} from "./mode-policy-notice";

const { api } = vi.hoisted(() => ({
  api: { learningModeGetMany: vi.fn(), chatLearningModeUpdate: vi.fn() },
}));
vi.mock("@/lib/api", () => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
}));

const catalog: LearningModeCatalog = {
  modes: [
    { id: "standard", name: "Standard", description: "", version: 1 },
    { id: "tutor", name: "Tutor", description: "", version: 2 },
    { id: "explain_back", name: "Explain-back", description: "", version: 1 },
  ],
};

const learner: ModePolicySource = {
  kind: "learner",
  set_by: "You",
  allowed_modes: ["tutor", "explain_back"],
  reveal: "override_required",
  learner_can_lift: true,
};

function course(
  allowed_modes: ModePolicySource["allowed_modes"],
  reveal: ModePolicySource["reveal"] = "allowed",
): ModePolicySource {
  return {
    kind: "course",
    set_by: "Dr Teach",
    class_name: "Biology 101",
    allowed_modes,
    reveal,
    learner_can_lift: false,
  };
}

function policy(
  sources: ModePolicySource[],
  allowed_modes: ModePolicy["allowed_modes"],
  reveal: ModePolicy["reveal"] = "allowed",
): ModePolicy {
  return { sources, allowed_modes, reveal };
}

function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      {node}
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.learningModeGetMany.mockReset();
  api.chatLearningModeUpdate.mockReset();
  ApiClient.__registry.set(api as never);
  api.learningModeGetMany.mockResolvedValue({ data: catalog });
});

it("disables only modes a source the learner can't lift refuses", () => {
  const locked = policy([learner], ["tutor", "explain_back"]);
  // Standard stays choosable: choosing it asks to release the lock.
  expect(modeSelectable(locked, "standard")).toBe(true);
  const both = policy([course(["standard", "tutor"]), learner], ["tutor"]);
  expect(modeSelectable(both, "standard")).toBe(true);
  expect(modeSelectable(both, "explain_back")).toBe(false);
  expect(modeSelectable(null, "explain_back")).toBe(true);
});

it("lists each source and who set it", async () => {
  wrap(
    <ModePolicyNotice
      policy={policy(
        [course(["tutor", "explain_back"], "forbidden"), learner],
        ["tutor", "explain_back"],
        "forbidden",
      )}
    />,
  );
  await vi.waitFor(() =>
    expect(screen.getByLabelText("Course policy")).toHaveTextContent(
      "Biology 101: Tutor or Explain-back modes only, answers can't be revealed. Set by Dr Teach.",
    ),
  );
  expect(screen.getByLabelText("Mode policy")).toHaveTextContent(
    "You locked this chat",
  );
  expect(screen.queryByRole("alert")).toBeNull();
});

it("names only the reveal when the course allows every mode", async () => {
  wrap(
    <ModePolicyNotice
      policy={policy(
        [course(["standard", "tutor", "explain_back"], "forbidden")],
        ["standard", "tutor", "explain_back"],
        "forbidden",
      )}
    />,
  );
  await vi.waitFor(() =>
    expect(screen.getByLabelText("Course policy")).toHaveTextContent(
      /^Biology 101: answers can't be revealed\. Set by Dr Teach\.$/,
    ),
  );
});

it("offers unlocking when the lock and the course leave no mode", async () => {
  wrap(
    <ModePolicyNotice policy={policy([course(["standard"]), learner], [])} />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "No mode is left while this chat is locked. Unlock it to continue.",
  );
});

const chat = (overrides: Partial<ChatInfo>): ChatInfo => ({
  id: "c",
  user_id: "a",
  created_at: 0,
  updated_at: 0,
  learning_mode: "tutor",
  learning_mode_revision: 1,
  ...overrides,
});

it("shows a Standard chat's course limits without a lock action", async () => {
  wrap(
    <ModePolicyControl
      info={chat({
        learning_mode: "standard",
        mode_policy: policy([course(["standard"])], ["standard"]),
      })}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Course mode policy" }),
  );
  expect(await screen.findByRole("alertdialog")).toHaveTextContent(
    "Only they can change them",
  );
  expect(screen.queryByRole("button", { name: "Lock mode" })).toBeNull();
  expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
});

it("hides the control in a Standard chat with nothing limited", () => {
  wrap(<ModePolicyControl info={chat({ learning_mode: "standard" })} />);
  expect(screen.queryByRole("button")).toBeNull();
});

it("can't lock when the course would leave no learning mode", async () => {
  wrap(
    <ModePolicyControl
      info={chat({
        mode_policy: policy([course(["standard", "tutor"])], ["standard"]),
      })}
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Lock Tutor mode" }),
  );
  expect(await screen.findByRole("alertdialog")).toHaveTextContent(
    "Locking would leave no learning mode this course allows.",
  );
  expect(screen.getByRole("button", { name: "Lock mode" })).toBeDisabled();
});

it("keeps the course limit in view while offering Unlock", async () => {
  wrap(
    <ModePolicyControl
      info={chat({
        mode_policy: policy([course(["tutor"]), learner], ["tutor"]),
      })}
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Tutor mode locked. Unlock" }),
  );
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent("Your class's limits stay.");
  await vi.waitFor(() =>
    expect(screen.getByLabelText("Course policy")).toHaveTextContent(
      "Tutor mode only",
    ),
  );
  expect(screen.getByRole("button", { name: /Unlock/ })).toBeDisabled();
});

it("tells the student when the course turns memory off", async () => {
  const all: ModePolicySource["allowed_modes"] = [
    "standard",
    "tutor",
    "explain_back",
  ];
  wrap(
    <ModePolicyNotice
      policy={policy([{ ...course(all), memory_enabled: false }], all)}
    />,
  );
  await vi.waitFor(() =>
    expect(screen.getByLabelText("Course policy")).toHaveTextContent(
      /^Biology 101: memory is off\. Set by Dr Teach\.$/,
    ),
  );
});
