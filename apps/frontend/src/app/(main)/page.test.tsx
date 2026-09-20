import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import AppPage from "./page";

const mocks = vi.hoisted(() => ({
  createChatSession: vi.fn(),
  user: {
    name: "Ada Lovelace",
    settings: {
      default_agent_id: "main-default",
      agents: {
        "main-default": {
          id: "main-default",
          name: "Default assistant",
          description: "Main",
          sub_agent: false,
          model_id: "model-1",
          system_prompt: null,
          max_steps: 5,
          tools: ["sub_agent"],
          chat_parameters: {},
        },
        "main-override": {
          id: "main-override",
          name: "Writing assistant",
          description: "Main",
          sub_agent: false,
          model_id: "model-1",
          system_prompt: null,
          max_steps: 5,
          tools: ["sub_agent"],
          chat_parameters: {},
        },
        worker: {
          id: "worker",
          name: "Hidden worker",
          description: "Sub-agent",
          sub_agent: true,
          model_id: "model-1",
          system_prompt: null,
          max_steps: 5,
          tools: [],
          chat_parameters: {},
        },
      },
    },
  },
}));

vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => mocks.user,
}));
vi.mock("@/features/chat/hooks/use-chat-session-crud", () => ({
  useChatSessionCrud: () => ({ createChatSession: mocks.createChatSession }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("folder_id=folder-1"),
}));
vi.mock("@/components/animated-border", () => ({
  AnimatedBorder: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/logo", () => ({ default: () => null }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode }) => (
    <select aria-label="Main agent for new chat" value={value} onChange={(event) => onValueChange(event.target.value)}>{children}</select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));
vi.mock("@/features/chat/components/chat-input", () => ({
  default: ({ onSubmit, disabled }: { onSubmit: (payload: { prompt: string; files: string[] }) => void; disabled?: boolean }) => (
    <button disabled={disabled} onClick={() => onSubmit({ prompt: "Hello", files: [] })}>Start chat</button>
  ),
}));

const initialSettings = structuredClone(mocks.user.settings);

it("defaults to a main agent, excludes sub-agents, and sends an override", async () => {
  mocks.createChatSession.mockClear();
  render(<AppPage />);
  const user = userEvent.setup();

  expect(screen.getByRole("option", { name: "Default assistant" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Writing assistant" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Hidden worker" })).not.toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Main agent for new chat"), "main-override");
  await user.click(screen.getByRole("button", { name: "Start chat" }));

  expect(mocks.createChatSession).toHaveBeenCalledWith({
    body: {
      agent_id: "main-override",
      files: [],
      folder_id: "folder-1",
      user_prompt: "Hello",
    },
  });
});

it("requires a main-agent selection before a new chat can start", () => {
  (mocks.user as { settings: unknown }).settings = {
    default_agent_id: null,
    agents: {},
  };
  render(<AppPage />);

  expect(screen.getByRole("alert")).toHaveTextContent(
    "Create a main agent in Settings before starting a chat.",
  );
  expect(screen.getByRole("button", { name: "Start chat" })).toBeDisabled();
  (mocks.user as { settings: unknown }).settings = initialSettings;
});
