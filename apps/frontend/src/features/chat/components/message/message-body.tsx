import MarkdownViewer from "@/components/markdown-viewer";
import { Badge } from "@/components/ui/badge";
import { StreamingMessage } from "@/features/chat/types";
import type {
  LearningModeProvenance,
  RubricLabel as RubricLabelData,
  TemplateLabel as TemplateLabelData,
} from "@/lib/client";
import { cn } from "@/lib/utils";
import {
  ClipboardCheckIcon,
  GraduationCapIcon,
  LayoutTemplateIcon,
  TargetIcon,
} from "lucide-react";
import { levelLabel } from "@/features/templates/lib/levels";
import { hintLevelLabel } from "@/features/chat/components/chat-hint-controls";
import { FeedbackReply } from "./feedback-reply";
import { RubricFeedbackReply } from "./rubric-feedback-reply";

const contentClass = "flex w-full min-w-0 flex-1 flex-col";

export const MessageBody = ({ message }: { message: StreamingMessage }) => {
  const fromUser = message.role === "user";
  return (
    <>
      {!!message.skills?.length && (
        <div
          className={cn(
            "flex max-w-full flex-wrap gap-1",
            fromUser && "ml-auto",
          )}
          aria-label="Message skills"
        >
          {message.skills.map((skill) => (
            <Badge
              key={skill.id}
              variant="outline"
              className="max-w-full"
              title={skill.name}
            >
              <span className="truncate">
                /{skill.name} · r{skill.revision}
              </span>
            </Badge>
          ))}
        </div>
      )}
      {fromUser &&
        message.learning_mode &&
        message.learning_mode.id !== "standard" && (
          <LearningModeChip mode={message.learning_mode} />
        )}
      {fromUser && message.template && (
        <TemplateLabel label={message.template} />
      )}
      {fromUser && message.rubric && <RubricLabel label={message.rubric} />}
      {fromUser && message.goal && (
        <p
          className="text-muted-foreground ml-auto flex max-w-full min-w-0 items-center gap-1 text-xs"
          data-goal-label
          title={`Learning goal included: ${message.goal.text}${message.goal.target_date ? ` (target ${message.goal.target_date})` : ""}`}
        >
          <TargetIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">Goal included: {message.goal.text}</span>
        </p>
      )}
      {!fromUser && message.learning_mode && message.execution?.rubric ? (
        <RubricFeedbackReply
          content={message.content}
          mode={message.learning_mode.id}
          rubric={message.execution.rubric}
          className={contentClass}
        />
      ) : !fromUser &&
        message.learning_mode &&
        message.learning_mode.id !== "standard" ? (
        <FeedbackReply
          content={message.content}
          mode={message.learning_mode.id}
          className={contentClass}
        />
      ) : (
        <MarkdownViewer
          content={message.content}
          className={cn(
            contentClass,
            fromUser &&
              "bg-card text-card-foreground border-border rounded-surface rounded-br-control shadow-raised ml-auto w-fit max-w-full border px-3.5 py-2.5 sm:max-w-125 md:max-w-150 xl:max-w-250",
          )}
        />
      )}
    </>
  );
};

const TemplateLabel = ({ label }: { label: TemplateLabelData }) => (
  <p
    className="text-muted-foreground ml-auto flex max-w-full min-w-0 items-center gap-1 text-xs"
    data-template-label={label.available ? "available" : "unavailable"}
    title={
      label.available
        ? `Built with ${label.name} (revision ${label.revision}) at the ${label.level} level`
        : `${label.name} is no longer available`
    }
  >
    <LayoutTemplateIcon className="size-3.5 shrink-0" aria-hidden />
    <span className={cn("truncate", !label.available && "line-through")}>
      Built with {label.name}
    </span>
    <span className="shrink-0" data-template-level={label.level}>
      · {levelLabel(label.level)}
    </span>
    {!label.available && <span className="shrink-0">· unavailable</span>}
  </p>
);

/** The rubric pinned on a Draft feedback turn (US-57.1). */
const RubricLabel = ({ label }: { label: RubricLabelData }) => (
  <p
    className="text-muted-foreground ml-auto flex max-w-full min-w-0 items-center gap-1 text-xs"
    data-rubric-label={label.available ? "available" : "unavailable"}
    title={`${label.document.name} (revision ${label.revision}): ${label.document.criteria
      .map((criterion) => criterion.label)
      .join(
        ", ",
      )}${label.available ? "" : ". This rubric is no longer available."}`}
  >
    <ClipboardCheckIcon className="size-3.5 shrink-0" aria-hidden />
    <span className={cn("truncate", !label.available && "line-through")}>
      Rubric: {label.document.name}
    </span>
    {!label.available && <span className="shrink-0">· unavailable</span>}
  </p>
);

/** The mode pinned when this turn was accepted; Standard is not labelled. */
const LearningModeChip = ({ mode }: { mode: LearningModeProvenance }) => (
  <Badge
    variant="outline"
    className="ml-auto max-w-full"
    data-learning-mode={mode.id}
    data-hint-level={mode.hint_level ?? undefined}
    title={`Sent in ${mode.name} mode (version ${mode.version})`}
  >
    <GraduationCapIcon aria-hidden />
    <span className="truncate">
      <span className="sr-only">Learning mode: </span>
      {mode.name}
      {mode.hint_level && mode.hint_level !== "none" && (
        <> · {hintLevelLabel(mode.id, mode.hint_level)}</>
      )}
    </span>
  </Badge>
);
