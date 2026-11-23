"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { BrainIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import type { MemoryCategory, MemoryProposal, ToolResult } from "@/lib/client";
import {
  memoryProposalDismissMutation,
  memoryProposalGetOneOptions,
  memoryProposalGetOneQueryKey,
  memoryProposalSaveMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { errorDetail } from "@/lib/utils";
import {
  CATEGORY_LABELS,
  MEMORY_MAX_CHARS,
  memoryHref,
  memoryInvalidates,
} from "../lib";

/** The agent's memory tool (US-93.4). Its result carries the proposal id, never the text. */
export const PROPOSE_MEMORY = "propose_memory";

const proposed = z.object({ proposal_id: z.uuid() });

/** The proposals a message's run made: at most one, as the server allows one per run. */
export function proposalIds(results: ToolResult[] | null | undefined) {
  const ids: string[] = [];
  for (const result of results ?? []) {
    if (result.tool_call.function.name !== PROPOSE_MEMORY) continue;
    const parsed = proposed.safeParse(result.raw_result);
    if (parsed.success) ids.push(parsed.data.proposal_id);
  }
  return ids;
}

/** Where a proposal would be saved, in the person's words. */
export function destinationLabel(proposal: Pick<MemoryProposal, "kind">) {
  return proposal.kind === "project" ? "This project" : "You, in every chat";
}

/** A card for each memory a reply offered: Save, Edit or Dismiss. Nothing is saved without a click. */
export function MemoryProposalCards({ results }: { results: ToolResult[] }) {
  const ids = proposalIds(results);
  if (!ids.length) return null;
  return (
    <ul aria-label="Memory proposals" className="flex flex-col gap-2">
      {ids.map((id) => (
        <MemoryProposalCard key={id} proposalId={id} />
      ))}
    </ul>
  );
}

function MemoryProposalCard({ proposalId }: { proposalId: string }) {
  const options = { client, path: { proposal_id: proposalId } };
  const proposal = useQuery({
    ...memoryProposalGetOneOptions(options),
    retry: false,
  });
  // A deleted chat or proposal shows nothing; the reply still reads normally.
  if (!proposal.data) return null;
  return (
    <li className="bg-card rounded-surface grid max-w-md gap-2 border px-3 py-2">
      <ProposalBody
        proposal={proposal.data}
        invalidates={[
          memoryProposalGetOneQueryKey(options),
          ...memoryInvalidates(),
        ]}
      />
    </li>
  );
}

function ProposalBody({
  proposal,
  invalidates,
}: {
  proposal: MemoryProposal;
  invalidates: unknown[];
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(proposal.text);
  const [category, setCategory] = useState<MemoryCategory>(
    proposal.category ?? "learning",
  );
  const [sensitive, setSensitive] = useState(proposal.sensitive);
  const meta = { invalidates };
  const save = useMutation({ ...memoryProposalSaveMutation({ client }), meta });
  const dismiss = useMutation({
    ...memoryProposalDismissMutation({ client }),
    meta,
  });
  const isUser = proposal.kind === "user";
  const accessibility = isUser && category === "accessibility";
  const trimmed = text.trim();
  const tooLong = trimmed.length > MEMORY_MAX_CHARS;
  const busy = save.isPending || dismiss.isPending;
  const destination = destinationLabel(proposal);

  if (proposal.status === "saved") {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <BrainIcon aria-hidden="true" className="size-4 shrink-0" />
        <span>
          Saved to memory ({destination}).{" "}
          {proposal.memory_id && (
            <Link
              className="underline underline-offset-2"
              href={memoryHref({
                id: proposal.memory_id,
                kind: proposal.kind,
                project_id: proposal.project_id,
              })}
            >
              View memory
            </Link>
          )}
        </span>
      </p>
    );
  }
  if (proposal.status === "dismissed") {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <BrainIcon aria-hidden="true" className="size-4 shrink-0" />
        Not remembered. Asterism won&apos;t offer it again in this chat.
      </p>
    );
  }

  const submit = () =>
    save.mutate({
      path: { proposal_id: proposal.id },
      body: {
        text: editing ? trimmed : proposal.text,
        category: isUser ? (editing ? category : proposal.category) : null,
        sensitive: editing ? accessibility || sensitive : proposal.sensitive,
      },
    });

  return (
    <section aria-label="Remember this?" className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <BrainIcon
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0"
        />
        <h3 className="text-sm font-medium">Remember this?</h3>
        {proposal.sensitive && <Badge variant="secondary">Sensitive</Badge>}
      </div>
      {editing ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed && !tooLong) submit();
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor={`${id}-text`}>Memory</Label>
            <Textarea
              id={`${id}-text`}
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-describedby={`${id}-count`}
              aria-invalid={tooLong}
              rows={3}
              required
            />
            <p id={`${id}-count`} className="text-muted-foreground text-xs">
              {trimmed.length} / {MEMORY_MAX_CHARS} characters
            </p>
          </div>
          {isUser && (
            <div className="grid gap-1">
              <Label htmlFor={`${id}-category`}>Category</Label>
              <Select
                value={category}
                onValueChange={(value) => setCategory(value as MemoryCategory)}
              >
                <SelectTrigger id={`${id}-category`} className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${id}-sensitive`}
              checked={accessibility || sensitive}
              disabled={accessibility}
              onCheckedChange={(checked) => setSensitive(checked === true)}
            />
            <Label htmlFor={`${id}-sensitive`}>Sensitive</Label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={busy || !trimmed || tooLong}
            >
              {save.isPending ? "Saving…" : "Save memory"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className="text-sm break-words whitespace-pre-wrap">
            {proposal.text}
          </p>
          <p className="text-muted-foreground text-xs">
            Saves to: {destination}
            {isUser && proposal.category
              ? ` · ${CATEGORY_LABELS[proposal.category]}`
              : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={submit}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                dismiss.mutate({ path: { proposal_id: proposal.id } })
              }
            >
              Dismiss
            </Button>
          </div>
        </>
      )}
      {(save.error || dismiss.error) && (
        <p role="alert" className="text-destructive text-sm">
          {errorDetail(
            save.error ?? dismiss.error,
            "That didn't work. Reload the chat and try again.",
          )}
        </p>
      )}
    </section>
  );
}
