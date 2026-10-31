import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { isPlanErrorCode, PlanRecoveryNotice } from "./plan-usage";

vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  chatgptPlanUsageResumeMutation: () => ({ mutationFn: vi.fn() }),
}));

function show(code: string, message = "Provider said no") {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PlanRecoveryNotice code={code} message={message} onDismiss={vi.fn()} />
    </QueryClientProvider>,
  );
  return screen.getByRole("alert");
}

it("recognizes only ChatGPT plan codes", () => {
  expect(isPlanErrorCode("chatgpt_plan_usage_limit")).toBe(true);
  expect(isPlanErrorCode("chat_capacity")).toBe(false);
  expect(isPlanErrorCode(null)).toBe(false);
});

it.each([
  ["chatgpt_plan_reauthorization_required", "Sign in to ChatGPT again"],
  ["chatgpt_plan_not_connected", "ChatGPT is not connected"],
])("asks the user to connect again for %s", (code, title) => {
  const notice = show(code);
  expect(notice).toHaveAccessibleName(title);
  expect(within(notice).getByRole("link", { name: /ChatGPT/ })).toHaveAttribute(
    "href",
    "/settings?t=user&setting=chatgpt",
  );
});

it("explains temporary unavailability without a sign-in prompt", () => {
  const notice = show("chatgpt_plan_temporarily_unavailable");
  expect(notice).toHaveAccessibleName("ChatGPT plan temporarily unavailable");
  expect(within(notice).queryByRole("link")).not.toBeInTheDocument();
  expect(
    within(notice).getByRole("button", { name: "Dismiss" }),
  ).toBeInTheDocument();
});

it("falls back to the provider message for other plan codes", () => {
  const notice = show("chatgpt_plan_not_eligible", "Not available for you");
  expect(notice).toHaveTextContent("Not available for you");
});
