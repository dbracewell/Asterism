import type { Message, MessageExecution } from "@/lib/client";
import { record } from "@/test/delegation-records";
import { defaultPersonaProvenance } from "@/test/personas";
import { standardLearningMode } from "@/test/learning-modes";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { RunUsageSummary } from "./run-usage-summary";

const execution = (
  model: Partial<MessageExecution["model"]> = {},
): MessageExecution => ({
  persona: defaultPersonaProvenance,
  learning_mode: standardLearningMode,
  id: "e",
  request_message_id: "r",
  model_revision: 1,
  model: {
    id: "model",
    name: "Alpha",
    provider_id: "p",
    provider_name: "Provider",
    provider_type: "openai",
    available: true,
    pricing: { input_per_million: 2, output_per_million: 10 },
    ...model,
  },
  configuration: { id: "c", name: "Main", description: "", config_revision: 1 },
});

const step = (extra: Partial<Message> = {}): Message => ({
  id: crypto.randomUUID(),
  role: "assistant",
  content: "",
  status: "completed",
  created_at: 0,
  input_tokens: 1_000,
  output_tokens: 100,
  execution: execution(),
  ...extra,
});

it("summarizes the run and breaks it down per agent and step", async () => {
  render(
    <RunUsageSummary
      steps={[
        step({
          tool_calls: [],
          delegations: [
            record("child", {
              name: "<img src=x onerror=alert(1)>",
              steps: [{ input_tokens: 10, output_tokens: 1 }],
            }),
          ],
        }),
        step(),
      ]}
    />,
  );
  const trigger = screen.getByRole("button", { name: /Run usage/ });
  expect(trigger).toHaveTextContent("2,010 in · 201 out · ~$0.0060 (partial)");

  await userEvent.click(trigger);
  const agents = screen.getByRole("list", { name: "Usage by agent" });
  const main = within(agents).getByTestId("usage-agent-main");
  expect(main).toHaveTextContent("Main agent");
  expect(main).toHaveTextContent("Step 1");
  expect(main).toHaveTextContent("Step 2");
  // Untrusted agent names render as text, never markup.
  const child = within(agents).getByTestId("usage-agent-child");
  expect(child).toHaveTextContent("<img src=x onerror=alert(1)>");
  expect(child.querySelector("img")).toBeNull();
  expect(screen.getByText(/not included in the cost/)).toBeInTheDocument();
});

it("shows ChatGPT plan instead of dollars for plan runs", () => {
  render(
    <RunUsageSummary
      steps={[
        step({
          execution: execution({ provider_type: "chatgpt", pricing: null }),
        }),
      ]}
    />,
  );
  expect(screen.getByRole("button", { name: /Run usage/ })).toHaveTextContent(
    "1,000 in · 100 out · ChatGPT plan",
  );
});

it("renders nothing when the provider reported no usage", () => {
  const { container } = render(
    <RunUsageSummary steps={[step({ input_tokens: 0, output_tokens: 0 })]} />,
  );
  expect(container).toBeEmptyDOMElement();
});
