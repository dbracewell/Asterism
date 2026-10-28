import MarkdownViewer from "@/components/markdown-viewer";
import { Badge } from "@/components/ui/badge";
import { StreamingMessage } from "@/features/chat/types";
import { cn } from "@/lib/utils";

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
