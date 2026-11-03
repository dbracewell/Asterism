import {
  ApiClient,
  type LearningModeCatalog,
  type RubricProvenance,
} from "@/lib/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { RubricFeedbackReply } from "./rubric-feedback-reply";

const { api } = vi.hoisted(() => ({
  api: { learningModeGetMany: vi.fn() },
}));
vi.mock("@/lib/api", () => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
}));
vi.mock("@/components/markdown-viewer", () => ({
  default: ({ content }: { content: string }) => (
    <div data-markdown>{content}</div>
  ),
}));

const catalog: LearningModeCatalog = {
  modes: [
    {
      id: "draft_feedback",
      name: "Draft feedback",
      description: "",
      version: 1,
      rubric_feedback: {
        level_label: "Estimated level",
        overall_heading: "Overall",
      },
    },
  ],
};

const rubric: RubricProvenance = {
  source: "bundled",
  id: "argumentative-essay",
  revision: 1,
  name: "Argumentative essay",
  levels: ["Exemplary", "Proficient", "Developing", "Beginning"],
  criteria: ["Thesis", "Evidence"],
};

const reply = `### Thesis
Estimated level: Proficient

> Uniforms should be required.

Clear claim.

### Evidence
Estimated level: Okay

Needs a source.

### Overall
Find a study.`;

beforeEach(() => {
  api.learningModeGetMany.mockReset();
  ApiClient.__registry.set(api as never);
  api.learningModeGetMany.mockResolvedValue({ data: catalog });
});

function wrap(children: ReactNode) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  );
}

it("renders one card per criterion with its estimated level", async () => {
  render(
    wrap(
      <RubricFeedbackReply
        content={reply}
        mode="draft_feedback"
        rubric={rubric}
      />,
    ),
  );
  const group = await screen.findByRole("group", {
    name: "Feedback against Argumentative essay",
  });
  expect(
    within(group)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent),
  ).toEqual(["Thesis", "Evidence", "Overall"]);
  const thesis = screen.getByRole("region", { name: "Thesis" });
  expect(thesis).toHaveTextContent("Estimated level: Proficient, 3 of 4");
  expect(thesis).toHaveTextContent("> Uniforms should be required.");
  expect(thesis).not.toHaveTextContent("###");
  expect(
    within(thesis).getByTitle("Estimated level 3 of 4, where 4 is highest"),
  ).toHaveAttribute("data-rubric-level", "1");
  const evidence = screen.getByRole("region", { name: "Evidence" });
  expect(evidence).toHaveTextContent("Okay· not in rubric");
  expect(screen.getByRole("region", { name: "Overall" })).toHaveTextContent(
    "Find a study.",
  );
  expect(group).toHaveTextContent("Levels are estimates.");
});

it("renders other replies, like an example rewrite, as Markdown", async () => {
  render(
    wrap(
      <RubricFeedbackReply
        content="Example rewrite: Uniforms reduce visible inequality."
        mode="draft_feedback"
        rubric={rubric}
      />,
    ),
  );
  await vi.waitFor(() => expect(api.learningModeGetMany).toHaveBeenCalled());
  expect(screen.getByText(/Example rewrite/)).toHaveAttribute("data-markdown");
  expect(screen.queryByRole("group")).toBeNull();
});
