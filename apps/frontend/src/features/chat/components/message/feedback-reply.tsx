"use client";

import MarkdownViewer from "@/components/markdown-viewer";
import { learningModeQueryOptions } from "@/features/chat/components/chat-learning-mode-picker";
import { parseFeedback } from "@/features/chat/lib/feedback-sections";
import type { FeedbackSectionId, LearningModeId } from "@/lib/client";
import { useQuery } from "@tanstack/react-query";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  type LucideIcon,
} from "lucide-react";
import { useId } from "react";

const sectionIcon: Record<FeedbackSectionId, LucideIcon> = {
  correct: CircleCheckIcon,
  gaps: CircleAlertIcon,
  follow_up: CircleHelpIcon,
};

/**
 * An assistant reply in a mode with structured feedback (Explain-back). The
 * catalog supplies the fixed headings; a reply that does not use them, such as
 * the request to explain a topic, renders as ordinary Markdown.
 */
export function FeedbackReply({
  content,
  mode,
  className,
}: {
  content: string;
  mode: LearningModeId;
  className?: string;
}) {
  const catalog = useQuery(learningModeQueryOptions());
  const sections = catalog.data?.modes.find(
    (item) => item.id === mode,
  )?.feedback_sections;
  const feedback = sections ? parseFeedback(content, sections) : null;
  if (!feedback)
    return <MarkdownViewer content={content} className={className} />;
  return (
    <div
      role="group"
      aria-label="Explanation feedback"
      className="flex w-full min-w-0 flex-col gap-3"
      data-feedback-reply={mode}
    >
      {feedback.preamble && <MarkdownViewer content={feedback.preamble} />}
      {feedback.sections.map((section) => (
        <FeedbackSectionBlock key={section.id} {...section} />
      ))}
    </div>
  );
}

function FeedbackSectionBlock({
  id,
  heading,
  body,
}: {
  id: FeedbackSectionId;
  heading: string;
  body: string;
}) {
  const headingId = useId();
  const Icon = sectionIcon[id];
  return (
    <section
      aria-labelledby={headingId}
      data-feedback-section={id}
      className="border-border rounded-surface flex min-w-0 flex-col gap-1.5 border px-3.5 py-3"
    >
      <h3
        id={headingId}
        className="text-foreground flex items-center gap-2 text-sm font-medium"
      >
        <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
        {heading}
      </h3>
      {body && <MarkdownViewer content={body} />}
    </section>
  );
}
