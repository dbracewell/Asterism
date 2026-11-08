import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { JoinedClass } from "@/lib/client";
import { ClassInsights } from "./class-insights";
import { InsightsConsent } from "./insights-consent";

const mocks = vi.hoisted(() => ({ insights: vi.fn(), consent: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  classInsightsGetOptions: () => ({
    queryKey: ["insights"],
    queryFn: mocks.insights,
  }),
  classInsightsConsentUpdateMutation: () => ({ mutationFn: mocks.consent }),
}));

const wrap = (node: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      {node}
    </QueryClientProvider>,
  );

beforeEach(() => vi.clearAllMocks());

it("waits for enough students to share", async () => {
  mocks.insights.mockResolvedValue({
    min_group_size: 5,
    consenting_students: 1,
    topics: [],
    hidden_topics: 0,
  });
  wrap(<ClassInsights classId="c1" />);
  expect(
    await screen.findByText(
      "Insights appear once at least 5 students share their results. 1 has so far.",
    ),
  ).toBeInTheDocument();
});

it("lists course files weakest first with totals only", async () => {
  mocks.insights.mockResolvedValue({
    min_group_size: 5,
    consenting_students: 7,
    topics: [
      {
        name: "cells.txt",
        students: 6,
        average_score: 0.3,
        needs_work_share: 0.7,
      },
    ],
    hidden_topics: 2,
  });
  wrap(<ClassInsights classId="c1" />);
  const list = await screen.findByRole("list", {
    name: "Course files, weakest first",
  });
  expect(within(list).getByText("cells.txt")).toBeInTheDocument();
  expect(
    within(list).getByText(
      "Average score 30% · 70% need more work · 6 students",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText("2 more files have too few students to show."),
  ).toBeInTheDocument();
});

it("lets a student opt in", async () => {
  wrap(
    <InsightsConsent
      item={
        {
          id: "c1",
          name: "Biology",
          description: "",
          educator_name: "Dr Teach",
          insights_consent: false,
        } as JoinedClass
      }
    />,
  );
  // Sharing starts off, with help beside the switch (US-66.2).
  expect(
    screen.getByRole("switch", {
      name: "Share my practice results in class totals",
    }),
  ).not.toBeChecked();
  expect(
    screen.getByRole("button", { name: "Help: Class insights" }),
  ).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("switch", {
      name: "Share my practice results in class totals",
    }),
  );
  expect(mocks.consent.mock.calls[0]?.[0]).toEqual({
    path: { class_id: "c1" },
    body: { consent: true },
  });
});
