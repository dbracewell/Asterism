import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import AppPage from "./page";
const mocks = vi.hoisted(() => ({ createChatSession: vi.fn(), user: { name: "Ada", settings: {
  main_agent: { id: "main", name: "Main agent" }, default_model_id: "model", models: [{ id: "model" }], sub_agents: { worker: { name: "Hidden worker" } },
} } }));
vi.mock("@/features/auth/components/user-context", () => ({ useUser: () => mocks.user }));
vi.mock("@/features/chat/hooks/use-chat-session-crud", () => ({ useChatSessionCrud: () => ({ createChatSession: mocks.createChatSession }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("project_id=project") }));
vi.mock("@/components/animated-border", () => ({ AnimatedBorder: ({ borderComponent, children }: { borderComponent: React.ReactNode; children: React.ReactNode }) => <>{borderComponent}{children}</> }));
vi.mock("@/components/logo", () => ({ default: () => null }));
vi.mock("@/features/chat/components/chat-input", () => ({
  ChatInput: ({ onSubmit, disabled }: { onSubmit: (value: unknown) => void; disabled: boolean }) => <button disabled={disabled} onClick={() => onSubmit({ prompt: "Hello", files: [], requestId: "request" })}>Start chat</button>,
  ChatInputContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
it("uses the sole main configuration without offering or sending an agent choice", async () => {
  render(<AppPage />);
  expect(screen.getByText("Main agent")).toBeVisible();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByText("Hidden worker")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Start chat" }));
  expect(mocks.createChatSession).toHaveBeenCalledWith({ body: { request_id: "request", project_id: "project", user_prompt: "Hello", files: [] } });
});
it("requires an explicitly selected available model", () => {
  mocks.user.settings.default_model_id = "unavailable";
  render(<AppPage />);
  expect(screen.getByRole("alert")).toHaveTextContent("Choose an available default model");
  expect(screen.getByRole("button", { name: "Start chat" })).toBeDisabled();
  mocks.user.settings.default_model_id = "model";
});
