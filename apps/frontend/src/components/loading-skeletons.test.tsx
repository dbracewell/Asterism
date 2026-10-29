import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  FormSkeleton,
  ListSkeleton,
  NavListSkeleton,
  PageHeaderSkeleton,
  TranscriptSkeleton,
} from "./loading-skeletons";

it.each([
  ["list", <ListSkeleton key="list" label="Loading projects" detail />],
  ["form", <FormSkeleton key="form" label="Loading personas…" />],
  ["nav", <NavListSkeleton key="nav" label="Loading chats" />],
  ["header", <PageHeaderSkeleton key="header" label="Loading project" />],
  [
    "transcript",
    <TranscriptSkeleton key="transcript" label="Loading conversation" />,
  ],
])(
  "the %s skeleton keeps a polite, named status announcement",
  (_, element) => {
    const { container } = render(element);
    const status = screen.getByRole("status");
    const label = status.getAttribute("aria-label")!;
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("status", { name: label })).toHaveTextContent(
      label,
    );
    const shapes = container.querySelectorAll("[data-slot=skeleton]");
    expect(shapes.length).toBeGreaterThan(0);
    shapes.forEach((shape) =>
      expect(shape.closest("[aria-hidden=true]")).not.toBeNull(),
    );
  },
);
