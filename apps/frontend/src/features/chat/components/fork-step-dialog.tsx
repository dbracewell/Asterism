"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import type { DelegationRecord, ForkInstructions } from "@/lib/client";
import {
  chatForkInstructionsGetOptions,
  chatMessageForkMutation,
  subAgentInstructionsUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

export type ForkSource = { messageId: string; record: DelegationRecord };

const errorDetail = (error: unknown) =>
  error &&
  typeof error === "object" &&
  "detail" in error &&
  typeof error.detail === "string"
    ? error.detail
    : "Retry, or reload the page if it keeps failing.";

/**
 * "Fork from here" (US-54.5, ADR-0038): edit one sub-agent's instructions for
 * this run only and run it again on a new branch. Saving the instructions to
 * the sub-agent definition is a separate, explicit action.
 */
export function ForkStepDialog({
  chatId,
  source,
  onOpenChange,
  onForked,
}: {
  chatId: string;
  /** The delegation being forked; `null` closes the dialog. */
  source: ForkSource | null;
  onOpenChange: (open: boolean) => void;
  onForked: () => void | Promise<void>;
}) {
  return (
    <Dialog open={source !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {source && (
          <ForkForm
            // A new source starts a fresh draft and request.
            key={`${source.messageId}:${source.record.execution_id}`}
            chatId={chatId}
            source={source}
            onClose={() => onOpenChange(false)}
            onForked={onForked}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ForkForm({
  chatId,
  source,
  onClose,
  onForked,
}: {
  chatId: string;
  source: ForkSource;
  onClose: () => void;
  onForked: () => void | Promise<void>;
}) {
  const instructions = useQuery(
    chatForkInstructionsGetOptions({
      client,
      path: { chat_id: chatId, message_id: source.messageId },
      query: { delegation_execution_id: source.record.execution_id },
    }),
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>Fork from {source.record.name}</DialogTitle>
        <DialogDescription>
          Change this sub-agent&apos;s instructions for this run only. Earlier
          steps are reused, and the run continues on a new branch. The original
          answer stays as a branch you can switch back to.
        </DialogDescription>
      </DialogHeader>
      {instructions.isPending ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner /> Loading instructions…
        </div>
      ) : instructions.error ? (
        <>
          <p role="alert" className="text-destructive text-sm">
            {errorDetail(instructions.error)}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </>
      ) : (
        <ForkEditor
          chatId={chatId}
          source={source}
          loaded={instructions.data}
          onClose={onClose}
          onForked={onForked}
        />
      )}
    </>
  );
}

function ForkEditor({
  chatId,
  source,
  loaded,
  onClose,
  onForked,
}: {
  chatId: string;
  source: ForkSource;
  loaded: ForkInstructions;
  onClose: () => void;
  onForked: () => void | Promise<void>;
}) {
  const fieldId = useId();
  const [draft, setDraft] = useState(loaded.instructions);
  const [requestId] = useState(() => crypto.randomUUID());
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const fork = useMutation(chatMessageForkMutation({ client }));
  const save = useMutation(subAgentInstructionsUpdateMutation({ client }));
  const nested = loaded.rerun_execution_id !== source.record.execution_id;
  const revision = savedRevision ?? loaded.definition_revision;

  return (
    <>
      <div className="flex min-w-0 flex-col gap-2 text-sm">
        {nested && (
          <p className="text-muted-foreground">
            {loaded.sub_agent_name} ran inside {loaded.rerun_sub_agent_name}, so{" "}
            {loaded.rerun_sub_agent_name} runs again from its call. Its other
            work may change too.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={fieldId}>
            {loaded.sub_agent_name} instructions for this run
          </Label>
          <Badge variant="secondary">
            {loaded.source === "fork"
              ? "From this fork"
              : "Sub-agent's current instructions"}
          </Badge>
        </div>
        <Textarea
          id={fieldId}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            save.reset();
          }}
          className="max-h-[50vh] min-h-40 overflow-y-auto font-mono"
        />
        <p className="text-muted-foreground">
          The sub-agent keeps its own tools, model and file access. The
          instructions change nothing else.
        </p>
        {save.isSuccess && (
          <p role="status" className="text-muted-foreground">
            Saved to {loaded.sub_agent_name}. Future runs use these
            instructions.
          </p>
        )}
        {(fork.error || save.error) && (
          <p role="alert" className="text-destructive">
            {errorDetail(fork.error ?? save.error)}
          </p>
        )}
      </div>
      <DialogFooter className="gap-2 sm:justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={save.isPending || save.isSuccess}
          onClick={async () => {
            try {
              const saved = await save.mutateAsync({
                path: { agent_id: loaded.sub_agent_id },
                body: { system_prompt: draft, expected_revision: revision },
              });
              setSavedRevision(saved.config_revision ?? null);
            } catch {
              // Shown in the dialog.
            }
          }}
        >
          {save.isPending ? "Saving…" : "Save to sub-agent"}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={fork.isPending}
            onClick={async () => {
              try {
                await fork.mutateAsync({
                  path: { chat_id: chatId, message_id: source.messageId },
                  body: {
                    request_id: requestId,
                    delegation_execution_id: source.record.execution_id,
                    instructions: draft,
                  },
                });
              } catch {
                return; // Shown in the dialog; the same request ID retries safely.
              }
              await onForked();
              onClose();
            }}
          >
            {fork.isPending ? "Starting…" : "Run fork"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
