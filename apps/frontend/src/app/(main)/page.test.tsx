import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import AppPage from "./page";
const mocks = vi.hoisted(() => ({ createChatSession: vi.fn(), user: { name: "Ada", settings: {
  main_agent: { id: "main", name: "Main agent" }, default_model_id: "model",
} } }));
vi.mock("@/features/auth/components/user-context", () => ({ useUser: () => mocks.user }));
vi.mock("@/features/chat/hooks/use-chat-session-crud", () => ({ useChatSessionCrud: () => ({ createChatSession: mocks.createChatSession }) }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({ chatModelsListOptions: () => ({ queryKey: ["models"], queryFn: async () => [{ id: "model", available: true }, { id: "other", available: true }] }) }));
vi.mock("@/features/chat/components/chat-model-picker", () => ({ ChatModelPicker: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <select aria-label="Chat model" value={value} onChange={(event) => onChange(event.target.value)}><option value="">Choose</option><option value="model">Model A</option><option value="other">Model B</option></select> }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("project_id=project") }));
vi.mock("@/components/animated-border", () => ({ AnimatedBorder: ({ borderComponent, children }: { borderComponent: React.ReactNode; children: React.ReactNode }) => <>{borderComponent}{children}</> }));
vi.mock("@/components/logo", () => ({ default: () => null }));
vi.mock("@/features/chat/components/chat-input", () => ({
  ChatInput: ({ onSubmit, disabled }: { onSubmit: (value: unknown) => void; disabled: boolean }) => <button disabled={disabled} onClick={() => onSubmit({ prompt: "Hello", files: [], requestId: "request" })}>Start chat</button>,
  ChatInputContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
function renderPage() { return render(<QueryClientProvider client={new QueryClient()}><AppPage /></QueryClientProvider>); }
it("prefills only the explicit default, permits a different model, and sends it independently of the main configuration", async () => {
  renderPage();
  expect(screen.getByText("Main agent")).toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());
  await userEvent.selectOptions(screen.getByLabelText("Chat model"), "other");
  await userEvent.click(screen.getByRole("button", { name: "Start chat" }));
  expect(mocks.createChatSession).toHaveBeenCalledWith({ body: { request_id: "request", model_id: "other", project_id: "project", user_prompt: "Hello", files: [] } });
});
it("retains an unavailable default without choosing a first-available replacement", async () => {
  mocks.user.settings.default_model_id = "unavailable";
  renderPage();
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Start chat" })).toBeDisabled();
  expect(screen.getByLabelText("Chat model")).not.toHaveValue("model");
  mocks.user.settings.default_model_id = "model";
});
