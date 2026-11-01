import { ApiClient, type LearningModeCatalog } from "@/lib/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { FeedbackReply } from "./feedback-reply";

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
    { id: "tutor", name: "Tutor", description: "", version: 2 },
    {
      id: "explain_back",
      name: "Explain-back",
      description: "",
      version: 2,
      feedback_sections: [
        { id: "correct", heading: "What you got right" },
        { id: "gaps", heading: "What was missing or wrong" },
        { id: "follow_up", heading: "Follow-up questions" },
      ],
    },
  ],
};

const reply = `### What you got right
Plants use sunlight.

### What was missing or wrong
You left out carbon dioxide.

### Follow-up questions
1. Which gas do plants take in?`;

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

it("renders each feedback section under its catalog heading", async () => {
  render(wrap(<FeedbackReply content={reply} mode="explain_back" />));
  const group = await screen.findByRole("group", {
    name: "Explanation feedback",
  });
  const headings = within(group)
    .getAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent);
  expect(headings).toEqual([
    "What you got right",
    "What was missing or wrong",
    "Follow-up questions",
  ]);
  const gaps = screen.getByRole("region", {
    name: "What was missing or wrong",
  });
  expect(gaps).toHaveAttribute("data-feedback-section", "gaps");
  expect(gaps).toHaveTextContent("You left out carbon dioxide.");
  expect(gaps).not.toHaveTextContent("###");
});

it("renders a request to explain as ordinary Markdown", async () => {
  render(
    wrap(
      <FeedbackReply
        content="Explain photosynthesis in your own words."
        mode="explain_back"
      />,
    ),
  );
  await vi.waitFor(() => expect(api.learningModeGetMany).toHaveBeenCalled());
  expect(
    screen.getByText("Explain photosynthesis in your own words."),
  ).toHaveAttribute("data-markdown");
  expect(screen.queryByRole("group")).toBeNull();
});

it("leaves replies in modes without feedback sections unstructured", async () => {
  render(wrap(<FeedbackReply content={reply} mode="tutor" />));
  await vi.waitFor(() => expect(api.learningModeGetMany).toHaveBeenCalled());
  expect(screen.queryByRole("group")).toBeNull();
  expect(screen.getByText(/### What you got right/)).toBeInTheDocument();
});
