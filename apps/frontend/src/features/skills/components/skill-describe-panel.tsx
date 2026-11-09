"use client";

import MarkdownViewer from "@/components/markdown-viewer";
import { EmptyState } from "@/components/empty-state";
import { ModelSelector } from "@/components/settings/model-selector";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useUser } from "@/features/auth/components/user-context";
import { SubAgentActivityPanel } from "@/features/chat/components/sub-agent-activity";
import { HelpTopic } from "@/features/help/components/help-topic";
import { client } from "@/lib/api";
import { chatModelsListOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fixPrompt, type SkillDraftRun } from "../hooks/use-skill-draft";
import { skillAvailabilityOptions } from "../queries";
import { SkillFailure } from "./skill-status";

/**
 * "Describe it" (US-71.2): the main agent writes a SKILL.md draft from a
 * description. A ready draft opens in the editor; nothing is saved here.
 */
export function SkillDescribePanel({
  owner,
  run,
  onEditDraft,
}: {
  owner: string;
  run: SkillDraftRun;
  /** Opens a draft that failed validation in the editor to fix by hand. */
  onEditDraft: (content: string) => void;
}) {
  const policy = useQuery(skillAvailabilityOptions(owner));
  if (policy.data && !policy.data.policy_enabled && !run.chat)
    return (
      <EmptyState
        role="note"
        className="flex-none items-start p-3 text-left"
        title="Describing a skill is turned off"
        description="An administrator has turned skills off, so your agent can't write drafts. You can still write a skill yourself."
      />
    );
  return run.chat ? (
    <DraftProgress run={run} onEditDraft={onEditDraft} />
  ) : (
    <DescribeForm run={run} />
  );
}

function DescribeForm({ run }: { run: SkillDraftRun }) {
  const user = useUser();
  const [description, setDescription] = useState("");
  const [examples, setExamples] = useState("");
  const [chosenModel, setChosenModel] = useState(
    user.settings.default_model_id ?? "",
  );
  const models = useQuery({
    ...chatModelsListOptions({ client }),
    staleTime: 0,
    retry: false,
  });
  const available = models.data?.filter((model) => model.available) ?? [];
  // With no choice or default, a lone available model is preselected.
  const modelId =
    chosenModel || (available.length === 1 ? available[0].id : "");
  const modelOk = available.some((model) => model.id === modelId);
  const blocked =
    run.starting.isPending ||
    !description.trim() ||
    description.length > 4000 ||
    examples.length > 8000 ||
    !modelOk;
  return (
    <form
      aria-label="Describe a skill"
      className="flex min-w-0 flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (blocked) return;
        try {
          await run.start({
            model_id: modelId,
            description: description.trim(),
            examples: examples.trim() || null,
          });
        } catch {
          /* The error stays visible with the description. */
        }
      }}
    >
      <p className="text-muted-foreground text-sm">
        Your main agent writes a SKILL.md draft for you to review. It may ask
        your General chat sub-agents for help. Nothing is saved until you save
        the skill. <HelpTopic id="concept.skill-draft" />
      </p>
      <Field>
        <FieldLabel htmlFor="skill-describe">
          What should the skill do?
        </FieldLabel>
        <Textarea
          id="skill-describe"
          className="min-h-28"
          maxLength={4000}
          value={description}
          disabled={run.starting.isPending}
          onChange={(event) => setDescription(event.target.value)}
        />
        <FieldDescription>
          Say when it should be used and what a good result looks like.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="skill-examples">Examples (optional)</FieldLabel>
        <Textarea
          id="skill-examples"
          className="min-h-20"
          maxLength={8000}
          value={examples}
          disabled={run.starting.isPending}
          onChange={(event) => setExamples(event.target.value)}
        />
        <FieldDescription>
          Sample requests and the kind of answer you&apos;d want.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="skill-writer-model">Writer model</FieldLabel>
        <ModelSelector
          id="skill-writer-model"
          aria-label="Writer model"
          value={modelId}
          onValueChange={setChosenModel}
          availableModels={models.data ?? []}
          showProvider
          showCapabilities
          disabled={!models.data || run.starting.isPending}
        />
        {models.isError && (
          <p role="alert" className="text-destructive text-sm">
            Could not load models.
          </p>
        )}
        {models.data && available.length === 0 && (
          <p role="alert" className="text-sm">
            No models are available to you.
          </p>
        )}
      </Field>
      {run.starting.error && (
        <SkillFailure
          error={run.starting.error}
          title="Could not start the draft"
        />
      )}
      <footer className="flex justify-end">
        <Button type="submit" disabled={blocked}>
          {run.starting.isPending ? "Starting…" : "Write draft"}
        </Button>
      </footer>
    </form>
  );
}

function DraftProgress({
  run,
  onEditDraft,
}: {
  run: SkillDraftRun;
  onEditDraft: (content: string) => void;
}) {
  const draft = run.draft.data;
  const settled = !run.running && !!draft;
  return (
    <section
      aria-label="Draft progress"
      className="flex min-w-0 flex-col gap-3"
    >
      <p role="status" className="text-sm">
        {run.running
          ? "Your agent is writing the draft…"
          : !draft
            ? "Reading the draft…"
            : draft.status === "ready"
              ? `Draft ready: ${draft.name}. It's open in Write it.`
              : draft.status === "none"
                ? "The writer stopped before writing a draft."
                : "The draft needs fixing."}
      </p>
      {run.runError && (
        <SkillFailure
          error={{ detail: run.runError }}
          title="The writer ran into a problem"
        />
      )}
      {run.draft.error && (
        <SkillFailure
          error={run.draft.error}
          title="Could not read the draft"
        />
      )}
      {run.running && run.streaming?.content && (
        <section
          aria-label="Writer output"
          className="rounded-surface max-h-64 min-w-0 overflow-y-auto border p-3 text-sm"
        >
          <MarkdownViewer content={run.streaming.content} />
        </section>
      )}
      <SubAgentActivityPanel activities={run.activities} />
      {settled && draft.status === "invalid" && (
        <EmptyState
          role="alert"
          className="flex-none items-start p-3 text-left"
          title="The draft didn't pass validation"
          description={draft.error ?? ""}
        />
      )}
      {run.sending.error && (
        <SkillFailure
          error={run.sending.error}
          title="Could not send your request"
        />
      )}
      <footer className="flex flex-wrap justify-end gap-2">
        {run.running && (
          <Button type="button" variant="outline" onClick={run.stop}>
            Stop writing
          </Button>
        )}
        {settled && draft.status === "invalid" && (
          <>
            {draft.content && (
              <Button
                type="button"
                variant="outline"
                onClick={() => onEditDraft(draft.content ?? "")}
              >
                Fix it myself
              </Button>
            )}
            <Button
              type="button"
              disabled={run.sending.isPending}
              onClick={() =>
                void run
                  .revise(fixPrompt(draft.error ?? "unknown error"))
                  .catch(() => {})
              }
            >
              Ask the writer to fix it
            </Button>
          </>
        )}
        {settled && draft.status === "none" && (
          <Button type="button" onClick={() => void run.discard()}>
            Start over
          </Button>
        )}
      </footer>
    </section>
  );
}
