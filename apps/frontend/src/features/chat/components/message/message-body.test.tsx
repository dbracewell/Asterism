import type { StreamingMessage } from "@/features/chat/types";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MessageBody } from "./message-body";

vi.mock("@/components/markdown-viewer", () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock("./feedback-reply", () => ({
  FeedbackReply: ({ content, mode }: { content: string; mode: string }) => (
    <div data-feedback-mode={mode}>{content}</div>
  ),
}));

const label = {
  source: "framework" as const,
  id: "rtf",
  revision: 1,
  level: "guided" as const,
  name: "RTF",
  available: true,
};

function message(overrides: Partial<StreamingMessage>) {
  return {
    id: "m",
    role: "user",
    content: "Do it.",
    ...overrides,
  } as StreamingMessage;
}

it("labels user messages built with a template", () => {
  render(<MessageBody message={message({ template: label })} />);
  const shown = screen.getByText("Built with RTF").closest("p");
  expect(shown).toHaveAttribute("data-template-label", "available");
  expect(shown).toHaveTextContent("Built with RTF· Guided");
  expect(screen.queryByText(/unavailable/)).toBeNull();
});

it("shows the recorded scaffolding level", () => {
  render(
    <MessageBody
      message={message({ template: { ...label, level: "standard" } })}
    />,
  );
  const shown = screen.getByText("Built with RTF").closest("p");
  expect(shown).toHaveAttribute(
    "title",
    "Built with RTF (revision 1) at the standard level",
  );
  expect(screen.getByText("· Standard")).toHaveAttribute(
    "data-template-level",
    "standard",
  );
});

it("keeps a deleted template's label, marked unavailable", () => {
  render(
    <MessageBody
      message={message({ template: { ...label, available: false } })}
    />,
  );
  const shown = screen.getByText("Built with RTF").closest("p");
  expect(shown).toHaveAttribute("data-template-label", "unavailable");
  expect(screen.getByText("· unavailable")).toBeInTheDocument();
});

it("shows no label without provenance or on assistant messages", () => {
  const { rerender } = render(<MessageBody message={message({})} />);
  expect(screen.queryByText(/Built with/)).toBeNull();
  rerender(
    <MessageBody message={message({ role: "assistant", template: label })} />,
  );
  expect(screen.queryByText(/Built with/)).toBeNull();
});

it("shows the pinned learning mode on user messages, but not Standard", () => {
  const tutor = { id: "tutor" as const, name: "Tutor", version: 1 };
  const { rerender } = render(
    <MessageBody message={message({ learning_mode: tutor })} />,
  );
  const chip = screen.getByText("Tutor").closest("[data-learning-mode]");
  expect(chip).toHaveAttribute("data-learning-mode", "tutor");
  expect(chip).toHaveAttribute("title", "Sent in Tutor mode (version 1)");
  expect(chip).toHaveTextContent("Learning mode: Tutor");
  rerender(
    <MessageBody
      message={message({
        learning_mode: { id: "standard", name: "Standard", version: 1 },
      })}
    />,
  );
  expect(screen.queryByText(/Learning mode/)).toBeNull();
  rerender(
    <MessageBody
      message={message({ role: "assistant", learning_mode: tutor })}
    />,
  );
  expect(screen.queryByText(/Learning mode/)).toBeNull();
});

it("adds the hint level to the chip once help was raised", () => {
  render(
    <MessageBody
      message={message({
        learning_mode: {
          id: "tutor",
          name: "Tutor",
          version: 2,
          hint_level: "worked_example",
        },
      })}
    />,
  );
  const chip = screen.getByText(/Tutor/).closest("[data-learning-mode]");
  expect(chip).toHaveAttribute("data-hint-level", "worked_example");
  expect(chip).toHaveTextContent("Learning mode: Tutor · Worked example");
});

it("labels a revealed Review solution in the chip", () => {
  render(
    <MessageBody
      message={message({
        learning_mode: {
          id: "review",
          name: "Review my work",
          version: 2,
          hint_level: "answer",
        },
      })}
    />,
  );
  const chip = screen
    .getByText(/Review my work/)
    .closest("[data-learning-mode]");
  expect(chip).toHaveTextContent(
    "Learning mode: Review my work · Solution shown",
  );
});

it("hands assistant replies in a learning mode to the feedback renderer", () => {
  const explainBack = {
    id: "explain_back" as const,
    name: "Explain-back",
    version: 2,
  };
  const { rerender } = render(
    <MessageBody
      message={message({ role: "assistant", learning_mode: explainBack })}
    />,
  );
  expect(screen.getByText("Do it.")).toHaveAttribute(
    "data-feedback-mode",
    "explain_back",
  );
  rerender(<MessageBody message={message({ learning_mode: explainBack })} />);
  expect(screen.getByText("Do it.")).not.toHaveAttribute("data-feedback-mode");
  rerender(
    <MessageBody
      message={message({
        role: "assistant",
        learning_mode: { id: "standard", name: "Standard", version: 1 },
      })}
    />,
  );
  expect(screen.getByText("Do it.")).not.toHaveAttribute("data-feedback-mode");
});
