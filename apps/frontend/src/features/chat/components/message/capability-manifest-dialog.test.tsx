import type { CapabilityManifest, Message } from "@/lib/client";
import { record } from "@/test/delegation-records";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { CapabilityManifestDialog } from "./capability-manifest-dialog";

const main: CapabilityManifest = {
  agent_id: "main",
  agent_name: "Main",
  is_sub_agent: false,
  configuration_revision: 1,
  model_supports_tools: true,
  entries: [
    {
      kind: "tool",
      id: "web_search",
      name: "web_search",
      grants: ["agent_assignment", "admin_policy", "model_support"],
      approval: "ask",
    },
    {
      kind: "sub_agent",
      id: "s",
      name: "<img src=x onerror=alert(1)>",
      grants: ["project_selection"],
    },
    { kind: "file", id: "f", name: null, grants: ["project_selection"] },
  ],
};

const steps = (delegations: Message["delegations"] = []): Message[] => [
  {
    id: "m",
    role: "assistant",
    content: "",
    status: "completed",
    created_at: 0,
    execution: {
      capabilities: main,
      model: { name: "Alpha" },
    } as Message["execution"],
    delegations,
  } as Message,
];

it("shows each agent's recorded capabilities and the grants behind them", async () => {
  render(
    <CapabilityManifestDialog
      steps={steps([
        record("child", {
          name: "Researcher",
          capabilities: {
            ...main,
            agent_name: "Researcher",
            is_sub_agent: true,
            model_supports_tools: false,
            entries: [],
          },
        }),
      ])}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Capabilities" }));
  const dialog = screen.getByRole("dialog", { name: "Capabilities" });

  const mainSection = within(dialog).getByTestId("capabilities-main");
  const tools = within(mainSection).getByRole("list", { name: "Tools" });
  expect(within(tools).getByText("web_search")).toBeVisible();
  for (const label of [
    "Assigned to the agent",
    "Enabled by the admin",
    "Model supports tools",
    "Asks you first",
  ]) {
    expect(within(tools).getByText(label)).toBeVisible();
  }
  // Untrusted names render as text, never markup.
  const subAgents = within(mainSection).getByRole("list", {
    name: "Sub-agents",
  });
  expect(
    within(subAgents).getByText("<img src=x onerror=alert(1)>"),
  ).toBeVisible();
  expect(dialog.querySelector("img")).toBeNull();
  expect(within(mainSection).getByText("Unavailable file")).toBeVisible();

  const child = within(dialog).getByTestId("capabilities-child");
  expect(
    within(child).getByText(
      "This model can't call tools, so no tools were offered.",
    ),
  ).toBeVisible();
  expect(within(child).getByText("Nothing")).toBeVisible();
});

it("says when a sub-agent recorded no manifest and hides itself when none did", async () => {
  const { unmount } = render(
    <CapabilityManifestDialog steps={steps([record("late")])} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Capabilities" }));
  expect(
    within(screen.getByTestId("capabilities-late")).getByText(
      "No capabilities were recorded for this agent.",
    ),
  ).toBeVisible();
  unmount();

  const { container } = render(
    <CapabilityManifestDialog
      steps={[{ ...steps()[0], execution: null } as Message]}
    />,
  );
  expect(container).toBeEmptyDOMElement();
});
