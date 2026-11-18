import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { UsageReport } from "@/lib/client";
import { UsageSettings } from "./usage-settings";

const mocks = vi.hoisted(() => ({
  report: vi.fn(),
  saveZone: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  usageSettingsGetOptions: () => ({
    queryKey: ["usage-settings"],
    queryFn: async () => ({ timezone: "Europe/London" }),
  }),
  usageGetReportOptions: ({
    query,
  }: {
    query: { start: string; end: string };
  }) => ({
    queryKey: ["usage-report", query],
    queryFn: async () => mocks.report(query),
  }),
  usageSettingsUpdateMutation: () => ({ mutationFn: mocks.saveZone }),
}));

const report: UsageReport = {
  timezone: "Europe/London",
  start: 0,
  end: 0,
  total_tokens: 1_500_000,
  cost_usd: 2.5,
  groups: [
    {
      group_id: "student",
      group_name: "Student",
      users: 1,
      total_tokens: 1_500_000,
      images: 2,
      cost_usd: 2.5,
    },
  ],
  users: [
    {
      user_id: "u1",
      name: "Ada",
      email: "ada@example.test",
      group_id: "student",
      group_name: "Student",
      total_tokens: 1_500_000,
      cost_usd: 2.5,
      models: [
        {
          model_id: "m1",
          model_name: "Fast",
          input_tokens: 1_000_000,
          output_tokens: 0,
          images: 0,
          cost_usd: 2.5,
          unpriced_tokens: 0,
        },
        {
          model_id: "m2",
          model_name: "Plan model",
          input_tokens: 400_000,
          output_tokens: 100_000,
          images: 2,
          cost_usd: null,
          unpriced_tokens: 500_000,
        },
      ],
    },
  ],
};

function setup() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <UsageSettings />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.report.mockResolvedValue(report);
});

it("shows usage per group and per user and model for the chosen days", async () => {
  const user = setup();
  const groups = await screen.findByRole("table", { name: "Usage per group" });
  expect(
    within(groups).getByRole("row", { name: /Student/ }),
  ).toHaveTextContent("Student11,500,0002$2.50");
  const people = screen.getByRole("table", {
    name: "Usage per user and model",
  });
  expect(within(people).getByText("ada@example.test")).toBeInTheDocument();
  expect(
    within(people).getByRole("row", { name: /Plan model/ }),
  ).toHaveTextContent("Plan model400,000100,0002—");
  // The default period is this month so far, in the usage timezone.
  const first = mocks.report.mock.calls[0][0];
  expect(first.start.endsWith("-01")).toBe(true);

  await user.clear(screen.getByLabelText("From"));
  await user.type(screen.getByLabelText("From"), "2026-01-05");
  await user.clear(screen.getByLabelText("To (included)"));
  await user.type(screen.getByLabelText("To (included)"), "2026-01-11");
  await waitFor(() =>
    expect(mocks.report).toHaveBeenLastCalledWith({
      start: "2026-01-05",
      end: "2026-01-11",
    }),
  );
});

it("says when a period has no usage, and saves the budget timezone", async () => {
  mocks.report.mockResolvedValue({ ...report, users: [], groups: [] });
  mocks.saveZone.mockResolvedValue({ timezone: "America/New_York" });
  const user = setup();
  expect(
    await screen.findByText("No usage in this period."),
  ).toBeInTheDocument();
  const zone = screen.getByLabelText("Timezone (IANA name)");
  expect(zone).toHaveValue("Europe/London");
  await user.clear(zone);
  await user.type(zone, "America/New_York");
  await user.click(screen.getByRole("button", { name: "Save timezone" }));
  await waitFor(() =>
    expect(mocks.saveZone.mock.calls[0][0]).toEqual({
      body: { timezone: "America/New_York" },
    }),
  );
});
