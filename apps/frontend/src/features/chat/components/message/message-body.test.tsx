import type { StreamingMessage } from "@/features/chat/types";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MessageBody } from "./message-body";

vi.mock("@/components/markdown-viewer", () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
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
