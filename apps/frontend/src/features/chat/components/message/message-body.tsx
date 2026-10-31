import MarkdownViewer from "@/components/markdown-viewer";
import { Badge } from "@/components/ui/badge";
import { StreamingMessage } from "@/features/chat/types";
import type {
  LearningModeProvenance,
  TemplateLabel as TemplateLabelData,
} from "@/lib/client";
import { cn } from "@/lib/utils";
import { GraduationCapIcon, LayoutTemplateIcon } from "lucide-react";
import { levelLabel } from "@/features/templates/lib/levels";

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
      <MarkdownViewer
        content={message.content}
        className={cn(
          "flex w-full min-w-0 flex-1 flex-col",
          fromUser &&
            "bg-card text-card-foreground border-border rounded-surface rounded-br-control shadow-raised ml-auto w-fit max-w-full border px-3.5 py-2.5 sm:max-w-125 md:max-w-150 xl:max-w-250",
        )}
      />
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

/** The mode pinned when this turn was accepted; Standard is not labelled. */
const LearningModeChip = ({ mode }: { mode: LearningModeProvenance }) => (
  <Badge
    variant="outline"
    className="ml-auto max-w-full"
    data-learning-mode={mode.id}
    title={`Sent in ${mode.name} mode (version ${mode.version})`}
  >
    <GraduationCapIcon aria-hidden />
    <span className="truncate">
      <span className="sr-only">Learning mode: </span>
      {mode.name}
    </span>
  </Badge>
);
