import { TooltipProvider } from "@/components/ui/tooltip";
import type { StreamingMessage } from "@/features/chat/types";
import { defaultPersonaProvenance } from "@/test/personas";
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MessageMeta } from "./message-meta";

vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ timezone: "UTC" }),
}));

const message = (extra: Partial<StreamingMessage>): StreamingMessage => ({
  id: "m",
  role: "assistant",
  content: "Hi",
  status: "completed",
  created_at: Date.now() / 1000,
  ...extra,
});

const execution = {
  persona: defaultPersonaProvenance,
  id: "e",
  request_message_id: "r",
  model_revision: 1,
  model: {
    id: "model",
    name: "Alpha",
    provider_id: "p",
    provider_name: "Provider",
    provider_type: "generic_openai" as const,
    available: true,
  },
  configuration: {
    id: "c",
    name: "Main",
    description: "",
    config_revision: 3,
  },
};

const renderMeta = (value: StreamingMessage) =>
  render(<MessageMeta message={value} />, { wrapper: TooltipProvider });

it("names the reply's recorded model with its provider and configuration", () => {
  const { container } = renderMeta(message({ execution }));
  const model = container.querySelector("[data-slot=executed-model]");
  expect(model).toHaveTextContent("Alpha");
  expect(model).toHaveAttribute("title", "Alpha · Provider · configuration 3");
  expect(container.firstChild?.textContent).toMatch(/^Alpha · /);
});

it("omits the model for user messages and replies without provenance", () => {
  for (const value of [
    message({ role: "user", execution }),
    message({ execution: null }),
  ]) {
    const { container, unmount } = renderMeta(value);
    expect(container.querySelector("[data-slot=executed-model]")).toBeNull();
    unmount();
  }
});
