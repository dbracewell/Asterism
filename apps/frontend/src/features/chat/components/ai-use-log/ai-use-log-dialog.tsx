"use client";

import MarkdownViewer from "@/components/markdown-viewer";
import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LOG_DISCLAIMER,
  defaultTimeFormat,
  renderAiUseLog,
} from "@/features/chat/lib/ai-use-log";
import { client } from "@/lib/api";
import type { AiUseLog } from "@/lib/client";
import {
  chatAiUseLogCreateMutation,
  chatSessionGetManyOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { createPortal } from "react-dom";

const MAX_CHATS = 50;

/**
 * Exports an AI-use log (US-57.4): choose chats from the project (or General),
 * then choose which prompts to include, and download Markdown or save a PDF
 * with the browser's print dialog. The log documents recorded provenance; it
 * never claims to detect AI use.
 */
export function AiUseLogDialog({
  projectId,
  initialChatIds,
  open,
  onOpenChange,
}: {
  /** The workspace whose chats are offered; null for General chats. */
  projectId: string | null;
  initialChatIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-3xl">
          <AiUseLogSteps
            projectId={projectId}
            initialChatIds={initialChatIds}
            onClose={() => onOpenChange(false)}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

function AiUseLogSteps({
  projectId,
  initialChatIds,
  onClose,
}: {
  projectId: string | null;
  initialChatIds: string[];
  onClose: () => void;
}) {
  const [chatIds, setChatIds] = useState(() => new Set(initialChatIds));
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const load = useMutation({
    ...chatAiUseLogCreateMutation({ client }),
    // Reading a log changes nothing, so no queries need refreshing.
    meta: { skipGlobalInvalidation: true },
    onSuccess: () => setExcluded(new Set()),
  });
  const log = load.data;
  if (!log)
    return (
      <ChooseChats
        projectId={projectId}
        selected={chatIds}
        onChange={setChatIds}
        pending={load.isPending}
        error={load.error}
        onCancel={onClose}
        onNext={() => load.mutate({ body: { chat_ids: [...chatIds] } })}
      />
    );
  return (
    <ChooseTurns
      log={log}
      excluded={excluded}
      onChange={setExcluded}
      onBack={() => load.reset()}
    />
  );
}

function ChooseChats({
  projectId,
  selected,
  onChange,
  pending,
  error,
  onCancel,
  onNext,
}: {
  projectId: string | null;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onNext: () => void;
}) {
  const prefix = useId();
  const chats = useQuery({
    ...chatSessionGetManyOptions({
      client,
      query: { project_id: projectId, page: 1, page_size: 100 },
    }),
    retry: false,
  });
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Export AI-use log</DialogTitle>
        <DialogDescription>
          Choose the chats to include. Next you can leave out individual
          prompts. {LOG_DISCLAIMER}
        </DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {chats.isPending && <ListSkeleton label="Loading chats" rows={4} />}
        {chats.error && (
          <QueryError
            error={chats.error}
            message="Could not load chats."
            retry={chats.refetch}
            isRetrying={chats.isFetching}
          />
        )}
        {chats.data && (
          <ul aria-label="Chats" className="flex flex-col divide-y border-y">
            {chats.data.chats.map((chat) => (
              <li key={chat.id} className="flex items-center gap-2 py-2">
                <Checkbox
                  id={`${prefix}-${chat.id}`}
                  checked={selected.has(chat.id)}
                  disabled={
                    pending ||
                    (!selected.has(chat.id) && selected.size >= MAX_CHATS)
                  }
                  onCheckedChange={(checked) =>
                    toggle(chat.id, checked === true)
                  }
                />
                <label
                  htmlFor={`${prefix}-${chat.id}`}
                  className="min-w-0 flex-1 truncate text-sm"
                >
                  {chat.title?.trim() || "Untitled chat"}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error != null && (
        <p role="alert" className="text-destructive text-sm">
          Could not build the log. A chat may have been deleted; reload and
          retry.
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!selected.size || pending} onClick={onNext}>
          {pending ? "Loading…" : `Choose prompts (${selected.size})`}
        </Button>
      </DialogFooter>
    </>
  );
}

function ChooseTurns({
  log,
  excluded,
  onChange,
  onBack,
}: {
  log: AiUseLog;
  excluded: Set<string>;
  onChange: (next: Set<string>) => void;
  onBack: () => void;
}) {
  const prefix = useId();
  const [printing, setPrinting] = useState(false);
  const turns = log.chats.flatMap((chat) => chat.turns);
  const included = new Set(
    turns.map((turn) => turn.message_id).filter((id) => !excluded.has(id)),
  );
  const markdown = renderAiUseLog(log, included);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(excluded);
    if (on) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `ai-use-log-${new Date(log.generated_at * 1000).toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const print = () => {
    setPrinting(true);
    document.body.classList.add("print-ai-use-log");
    const done = () => {
      document.body.classList.remove("print-ai-use-log");
      setPrinting(false);
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    // Let the print root render before the dialog opens.
    requestAnimationFrame(() => window.print());
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Choose prompts</DialogTitle>
        <DialogDescription>
          {included.size} of {turns.length} prompts included. Untick any you
          want to leave out.
        </DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {log.chats.map((chat) => (
          <section
            key={chat.chat_id}
            aria-label={chat.title?.trim() || "Untitled chat"}
            className="flex flex-col gap-1"
          >
            <h3 className="text-sm font-medium">
              {chat.title?.trim() || "Untitled chat"}
            </h3>
            {chat.turns.length === 0 && (
              <p className="text-muted-foreground text-sm">No prompts.</p>
            )}
            <ul className="flex flex-col gap-1">
              {chat.turns.map((turn) => (
                <li key={turn.message_id} className="flex items-start gap-2">
                  <Checkbox
                    id={`${prefix}-${turn.message_id}`}
                    className="mt-0.5"
                    checked={!excluded.has(turn.message_id)}
                    onCheckedChange={(checked) =>
                      toggle(turn.message_id, checked === true)
                    }
                  />
                  <label
                    htmlFor={`${prefix}-${turn.message_id}`}
                    className="flex min-w-0 flex-1 flex-col text-sm"
                  >
                    <span className="truncate">
                      {turn.prompt.trim() || "(files only)"}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {defaultTimeFormat(turn.at)} ·{" "}
                      {turn.learning_mode?.name ?? "Standard"}
                      {turn.reply?.exercise && " · Exercise"}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button variant="outline" disabled={!included.size} onClick={print}>
          Save as PDF
        </Button>
        <Button disabled={!included.size} onClick={download}>
          Download Markdown
        </Button>
      </DialogFooter>
      {printing &&
        createPortal(
          <div data-print-root className="hidden p-8">
            <MarkdownViewer content={markdown} />
          </div>,
          document.body,
        )}
    </>
  );
}
