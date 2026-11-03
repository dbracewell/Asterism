"use client";

import { FormSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { draftSegments } from "@/features/chat/lib/draft-segments";
import { client } from "@/lib/api";
import type {
  DraftCommentSummary,
  DraftCommentView,
  DraftDocument,
} from "@/lib/client";
import {
  chatDraftReviewCommentUpdateMutation,
  chatDraftReviewGetOneOptions,
  chatDraftReviewGetOneQueryKey,
  chatSessionGetOneQueryKey,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageSquareTextIcon } from "lucide-react";
import { useId, useState } from "react";

/**
 * Opens the learner's draft with the feedback's comments pinned to the
 * passages they quote (US-57.2).
 */
export function DraftReviewButton({
  chatId,
  messageId,
  summary,
}: {
  chatId: string;
  messageId: string;
  summary: DraftCommentSummary;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => setOpen(true)}
      >
        <MessageSquareTextIcon />
        Review draft with comments
        <span className="text-muted-foreground">
          · {summary.total} {summary.total === 1 ? "comment" : "comments"}
          {summary.resolved > 0 && `, ${summary.resolved} resolved`}
        </span>
      </Button>
      {open && (
        <DraftReviewDialog
          chatId={chatId}
          messageId={messageId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DraftReviewDialog({
  chatId,
  messageId,
  onClose,
}: {
  chatId: string;
  messageId: string;
  onClose: () => void;
}) {
  const prefix = useId();
  const path = { chat_id: chatId, message_id: messageId };
  const review = useQuery({
    ...chatDraftReviewGetOneOptions({ client, path }),
    staleTime: 0,
  });
  const update = useMutation({
    ...chatDraftReviewCommentUpdateMutation({ client }),
    meta: {
      invalidates: [
        chatDraftReviewGetOneQueryKey({ path }),
        chatSessionGetOneQueryKey({ path: { chat_id: chatId } }),
      ],
    },
  });
  const [selected, setSelected] = useState<string | null>(null);
  const markId = (id: string) => `${prefix}-mark-${id}`;
  const commentId = (id: string) => `${prefix}-comment-${id}`;
  const select = (id: string, reveal: "mark" | "comment") => {
    setSelected(id);
    requestAnimationFrame(() =>
      document
        .getElementById(reveal === "mark" ? markId(id) : commentId(id))
        ?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }),
    );
  };
  const comments = review.data?.comments ?? [];
  const anchored = comments.filter((comment) => comment.anchor);
  const unanchored = comments.filter((comment) => !comment.anchor);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Your draft with comments</DialogTitle>
          <DialogDescription>
            Select a comment to highlight the passage it is about, or select a
            highlighted passage to find its comment. Mark comments resolved as
            you revise.
          </DialogDescription>
        </DialogHeader>
        {review.isPending && <FormSkeleton label="Loading draft…" fields={3} />}
        {review.error && (
          <QueryError
            error={review.error}
            message="Could not load the draft."
            retry={review.refetch}
            isRetrying={review.isFetching}
          />
        )}
        {review.data && (
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_22rem] lg:overflow-hidden">
            <section
              aria-label="Your draft"
              className="flex min-w-0 flex-col gap-4 lg:overflow-y-auto lg:pr-2"
            >
              {review.data.documents.length === 0 && (
                <p className="text-muted-foreground">
                  The draft is no longer available.
                </p>
              )}
              {review.data.documents.map((document) => (
                <DocumentView
                  key={document.id}
                  document={document}
                  comments={anchored}
                  selected={selected}
                  markId={markId}
                  onSelect={(id) => select(id, "comment")}
                />
              ))}
            </section>
            <section
              aria-label="Comments"
              className="flex min-w-0 flex-col gap-3 lg:overflow-y-auto lg:pr-1"
            >
              {update.error && (
                <p role="alert" className="text-destructive text-sm">
                  Could not update the comment. Retry.
                </p>
              )}
              <ol className="flex flex-col gap-2">
                {anchored.map((comment) => (
                  <CommentItem
                    key={comment.id}
                    id={commentId(comment.id)}
                    comment={comment}
                    selected={selected === comment.id}
                    disabled={update.isPending}
                    onSelect={() => select(comment.id, "mark")}
                    onResolve={(resolved) =>
                      update.mutate({
                        path: { ...path, comment_id: comment.id },
                        body: { resolved },
                      })
                    }
                  />
                ))}
              </ol>
              {unanchored.length > 0 && (
                <section
                  aria-labelledby={`${prefix}-unanchored`}
                  className="flex flex-col gap-2"
                >
                  <h3
                    id={`${prefix}-unanchored`}
                    className="text-sm font-medium"
                  >
                    Not found in your draft
                  </h3>
                  <p className="text-muted-foreground text-xs">
                    The quoted text doesn&apos;t match your draft, so these
                    comments aren&apos;t pinned to a passage.
                  </p>
                  <ol className="flex flex-col gap-2">
                    {unanchored.map((comment) => (
                      <CommentItem
                        key={comment.id}
                        id={commentId(comment.id)}
                        comment={comment}
                        selected={selected === comment.id}
                        disabled={update.isPending}
                        onSelect={() => setSelected(comment.id)}
                        onResolve={(resolved) =>
                          update.mutate({
                            path: { ...path, comment_id: comment.id },
                            body: { resolved },
                          })
                        }
                      />
                    ))}
                  </ol>
                </section>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DocumentView({
  document,
  comments,
  selected,
  markId,
  onSelect,
}: {
  document: DraftDocument;
  comments: DraftCommentView[];
  selected: string | null;
  markId: (id: string) => string;
  onSelect: (id: string) => void;
}) {
  const headingId = useId();
  const own = comments.filter(
    (comment) => comment.anchor?.document_id === document.id,
  );
  const resolved = new Set(
    own.filter((comment) => comment.resolved).map((comment) => comment.id),
  );
  const segments =
    document.available && document.text
      ? draftSegments(
          document.text,
          own.map((comment) => ({
            id: comment.id,
            start: comment.anchor!.start,
            end: comment.anchor!.end,
          })),
        )
      : [];
  const marked = new Set<string>();
  return (
    <article
      aria-labelledby={headingId}
      className="border-border rounded-surface flex min-w-0 flex-col gap-2 border p-3"
    >
      <h3 id={headingId} className="text-sm font-medium wrap-anywhere">
        {document.name}
      </h3>
      {!document.available || !document.text ? (
        <p className="text-muted-foreground text-sm">
          {document.reason ?? "This part of the draft has no text."}
        </p>
      ) : (
        <p className="text-sm wrap-anywhere whitespace-pre-wrap">
          {segments.map((segment) => {
            if (!segment.ids.length)
              return <span key={segment.start}>{segment.text}</span>;
            const active = segment.ids.includes(selected ?? "");
            const target =
              segment.ids.find((id) => id === selected) ?? segment.ids[0];
            // The first segment of each comment is its scroll target.
            const first = segment.ids.find((id) => !marked.has(id));
            segment.ids.forEach((id) => marked.add(id));
            return (
              <mark
                key={segment.start}
                id={first ? markId(first) : undefined}
                data-comment-ids={segment.ids.join(" ")}
                data-selected={active || undefined}
                className={cn(
                  "text-foreground cursor-pointer",
                  segment.ids.every((id) => resolved.has(id))
                    ? "bg-muted underline decoration-dotted"
                    : "bg-primary/15",
                  active && "bg-primary/35 outline-primary outline-2",
                )}
                onClick={() => onSelect(target)}
              >
                {segment.text}
              </mark>
            );
          })}
        </p>
      )}
    </article>
  );
}

function CommentItem({
  id,
  comment,
  selected,
  disabled,
  onSelect,
  onResolve,
}: {
  id: string;
  comment: DraftCommentView;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onResolve: (resolved: boolean) => void;
}) {
  const checkboxId = useId();
  return (
    <li
      id={id}
      data-comment={comment.id}
      data-selected={selected || undefined}
      className={cn(
        "border-border rounded-surface flex min-w-0 flex-col gap-2 border p-2.5",
        selected && "border-primary ring-primary/30 ring-2",
        comment.resolved && "opacity-70",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        className="focus-visible:ring-ring rounded-control flex min-w-0 flex-col gap-1 text-left outline-none focus-visible:ring-2"
        onClick={onSelect}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{comment.criterion}</span>
          {comment.level && (
            <Badge variant="secondary">
              <span className="sr-only">Estimated level: </span>
              {comment.level}
            </Badge>
          )}
        </span>
        <span className="text-muted-foreground border-border border-l-2 pl-2 text-xs wrap-anywhere italic">
          {comment.quote}
        </span>
        {comment.note && (
          <span className="text-sm wrap-anywhere">{comment.note}</span>
        )}
      </button>
      <label
        htmlFor={checkboxId}
        className="text-muted-foreground flex items-center gap-2 text-xs"
      >
        <Checkbox
          id={checkboxId}
          checked={comment.resolved}
          disabled={disabled}
          onCheckedChange={(checked) => onResolve(checked === true)}
        />
        Resolved
      </label>
    </li>
  );
}
