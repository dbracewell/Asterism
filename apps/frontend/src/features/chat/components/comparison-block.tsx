"use client";

import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { client } from "@/lib/api";
import type { ComparisonColumn } from "@/lib/client";
import {
  chatComparisonActivateMutation,
  chatComparisonGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { type QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { CornerDownRightIcon, NetworkIcon } from "lucide-react";
import { SendJsonMessage } from "react-use-websocket/dist/lib/types";
import type { ToolTimings } from "../lib/agent-timeline";
import {
  columnLabel,
  columnModelName,
  runGraphReply,
  usageText,
} from "../lib/comparison";
import type { StreamingMessage } from "../types";
import { MessageItem } from "./message/message-item";
import { StreamingIndicator } from "./message/streaming-indicator";

type ComparisonBlockProps = {
  chatId: string;
  comparisonId: string;
  /** The live run, when it answers one of this comparison's columns. */
  stream: StreamingMessage | null;
  isProcessing: boolean;
  canRegenerate: boolean;
  onRegenerate: (parentId?: string | null) => void;
  toolTimings?: ToolTimings;
  sendJsonMessage: SendJsonMessage;
};

export const comparisonOptions = (chatId: string, comparisonId: string) => ({
  ...chatComparisonGetOneOptions({
    client,
    path: { chat_id: chatId, comparison_id: comparisonId },
  }),
  staleTime: 0,
});

/** Refetch every loaded comparison, e.g. after one of its runs finishes. */
export const invalidateComparisons = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({
    predicate: (query) =>
      (query.queryKey[0] as { _id?: string } | undefined)?._id ===
      "chatComparisonGetOne",
  });

/**
 * One prompt answered by two or three targets, in columns that stack on narrow
 * screens. Each column is its own chat branch; the conversation continues from
 * the active one.
 */
export function ComparisonBlock(props: ComparisonBlockProps) {
  const { chatId, comparisonId } = props;
  const query = useQuery(comparisonOptions(chatId, comparisonId));
  if (query.error && !query.data)
    return (
      <QueryError
        error={query.error}
        message="This comparison couldn't be loaded."
        retry={query.refetch}
        isRetrying={query.isFetching}
      />
    );
  if (!query.data)
    return (
      <div className="mb-5 flex flex-col gap-3" aria-busy="true">
        <Skeleton className="ml-auto h-10 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  const { columns, active_index: activeIndex } = query.data;
  const prompt = columns[0].request;
  const samePrompt = columns.every(
    (column) => column.request.content === prompt.content,
  );
  return (
    <section
      aria-label={`Comparison of ${columns.length} answers`}
      data-slot="comparison"
      className="@container mb-5 flex min-w-0 flex-col gap-2"
    >
      {samePrompt && (
        <MessageItem
          chatId={chatId}
          message={prompt}
          startsTurn
          isProcessing={props.isProcessing}
          canRegenerate={false}
          onRegenerate={props.onRegenerate}
          sendJsonMessage={props.sendJsonMessage}
        />
      )}
      <div
        className={cn(
          "grid min-w-0 grid-cols-1 gap-3",
          columns.length === 2 ? "@2xl:grid-cols-2" : "@3xl:grid-cols-3",
        )}
      >
        {columns.map((column) => (
          <Column
            key={column.request.id}
            {...props}
            column={column}
            active={column.index === activeIndex}
            showPrompt={!samePrompt}
          />
        ))}
      </div>
    </section>
  );
}

function Column({
  chatId,
  comparisonId,
  column,
  active,
  showPrompt,
  stream,
  isProcessing,
  canRegenerate,
  onRegenerate,
  toolTimings,
  sendJsonMessage,
}: ComparisonBlockProps & {
  column: ComparisonColumn;
  active: boolean;
  showPrompt: boolean;
}) {
  const activate = useMutation(chatComparisonActivateMutation({ client }));
  const label = columnLabel(column);
  const replies = column.replies ?? [];
  const live =
    stream?.comparison?.column_id === column.request.id ? stream : null;
  const graph = runGraphReply(column);
  const usage = usageText(column);
  const headingId = `comparison-${comparisonId}-${column.index}`;
  const status = live
    ? "Answering…"
    : column.status === "pending"
      ? "Waiting"
      : column.status === "cancelled"
        ? "Stopped"
        : null;
  return (
    <article
      aria-labelledby={headingId}
      data-active={active || undefined}
      className={cn(
        "rounded-surface bg-background flex min-w-0 flex-col gap-2 border p-3",
        active && "border-primary/60",
      )}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <h3 id={headingId} className="min-w-0 truncate font-medium">
          {label}
        </h3>
        {column.request.comparison_label && (
          <span className="text-muted-foreground min-w-0 truncate text-xs">
            {columnModelName(column)}
          </span>
        )}
        <span className="flex-1" />
        {status && <Badge variant="outline">{status}</Badge>}
        {active && <Badge variant="secondary">Continuing here</Badge>}
      </header>
      {showPrompt && (
        <blockquote className="text-muted-foreground border-l-2 pl-2 text-sm whitespace-pre-wrap">
          {column.request.content}
        </blockquote>
      )}
      <div className="min-w-0">
        {replies.map((reply, index) => (
          <div key={reply.id} id={`run-${reply.id}`} className="scroll-mt-4">
            <MessageItem
              chatId={chatId}
              message={reply}
              startsTurn={index === 0}
              isProcessing={isProcessing}
              // Regeneration runs on the active branch, so only that column offers it.
              canRegenerate={active && canRegenerate}
              onRegenerate={onRegenerate}
              toolTimings={toolTimings}
              sendJsonMessage={sendJsonMessage}
            />
          </div>
        ))}
        {live && (
          <MessageItem
            chatId={chatId}
            message={live}
            startsTurn={!replies.length}
            isProcessing={isProcessing}
            canRegenerate={false}
            onRegenerate={onRegenerate}
            streaming
            toolTimings={toolTimings}
            sendJsonMessage={sendJsonMessage}
          />
        )}
        {!live && column.status === "pending" && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            {isProcessing ? (
              <>
                <StreamingIndicator /> Waiting for its turn
              </>
            ) : (
              "Not answered yet"
            )}
          </p>
        )}
      </div>
      <footer className="text-muted-foreground text-meta mt-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {usage && <span data-slot="comparison-usage">{usage}</span>}
        {graph && (
          <a
            href={`#run-${graph.id}`}
            className="hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
          >
            <NetworkIcon className="size-3.5" />
            Run graph
          </a>
        )}
        {!active && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto max-w-full"
            disabled={
              isProcessing || column.status === "pending" || activate.isPending
            }
            onClick={() =>
              activate.mutate({
                path: { chat_id: chatId, comparison_id: comparisonId },
                body: { index: column.index },
              })
            }
          >
            <CornerDownRightIcon />
            <span className="truncate">Continue from {label}</span>
          </Button>
        )}
      </footer>
      {activate.error && (
        <p role="alert" className="text-destructive text-sm">
          This answer couldn&apos;t be selected. Reload and try again.
        </p>
      )}
    </article>
  );
}
