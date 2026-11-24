"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { LayersIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { client } from "@/lib/api";
import type {
  StudyProposalDeck,
  StudyProposal,
  StudyProposalQuiz,
  ToolResult,
} from "@/lib/client";
import {
  studyProposalDismissMutation,
  studyProposalGetOneOptions,
  studyProposalSaveMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { errorDetail } from "@/lib/utils";

/** The agent's study draft tools (EPIC-98). Results carry the draft id, never its text. */
export const STUDY_TOOLS = new Set(["propose_deck", "propose_quiz"]);

const drafted = z.object({ proposal_id: z.uuid() });

/** The drafts a message's run made: at most one deck and one quiz. */
export function studyProposalIds(results: ToolResult[] | null | undefined) {
  const ids: string[] = [];
  for (const result of results ?? []) {
    if (!STUDY_TOOLS.has(result.tool_call.function.name)) continue;
    const parsed = drafted.safeParse(result.raw_result);
    if (parsed.success) ids.push(parsed.data.proposal_id);
  }
  return ids;
}

/** Where a saved draft lives in the project's Study area. */
export function savedHref(proposal: StudyProposal): string | null {
  if (!proposal.saved_id) return null;
  const base = `/projects/${proposal.project_id}/study`;
  return proposal.kind === "deck"
    ? `${base}/${proposal.saved_id}`
    : `${base}/quizzes/${proposal.saved_id}`;
}

/** A card for each deck or quiz a reply drafted: Save to Study, Edit or Dismiss. */
export function StudyProposalCards({ results }: { results: ToolResult[] }) {
  const ids = studyProposalIds(results);
  if (!ids.length) return null;
  return (
    <ul aria-label="Study drafts" className="flex flex-col gap-2">
      {ids.map((id) => (
        <StudyProposalCard key={id} proposalId={id} />
      ))}
    </ul>
  );
}

function StudyProposalCard({ proposalId }: { proposalId: string }) {
  const proposal = useQuery({
    ...studyProposalGetOneOptions({
      client,
      path: { proposal_id: proposalId },
    }),
    retry: false,
  });
  // A deleted chat or draft shows nothing; the reply still reads normally.
  if (!proposal.data) return null;
  return (
    <li className="bg-card rounded-surface grid max-w-xl gap-2 border px-3 py-2">
      <ProposalBody proposal={proposal.data} />
    </li>
  );
}

function ProposalBody({ proposal }: { proposal: StudyProposal }) {
  const [editing, setEditing] = useState(false);
  const save = useMutation(studyProposalSaveMutation({ client }));
  const dismiss = useMutation(studyProposalDismissMutation({ client }));
  const busy = save.isPending || dismiss.isPending;
  const noun = proposal.kind === "deck" ? "flashcard deck" : "practice quiz";
  const title = proposal.deck?.title ?? proposal.quiz?.title ?? "";

  if (proposal.status === "saved") {
    const href = savedHref(proposal);
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <LayersIcon aria-hidden="true" className="size-4 shrink-0" />
        <span>
          Saved to Study.{" "}
          {href && (
            <Link className="underline underline-offset-2" href={href}>
              Open {proposal.kind === "deck" ? "deck" : "quiz"}
            </Link>
          )}
        </span>
      </p>
    );
  }
  if (proposal.status === "dismissed") {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <LayersIcon aria-hidden="true" className="size-4 shrink-0" />
        Draft {noun} dismissed.
      </p>
    );
  }

  const submit = (body: {
    deck?: StudyProposalDeck;
    quiz?: StudyProposalQuiz;
  }) => save.mutate({ path: { proposal_id: proposal.id }, body });
  const original =
    proposal.kind === "deck"
      ? { deck: proposal.deck ?? undefined }
      : { quiz: proposal.quiz ?? undefined };

  return (
    <section aria-label={`Draft ${noun}: ${title}`} className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <LayersIcon
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0"
        />
        <h3 className="text-sm font-medium">
          Draft {noun}: {title}
        </h3>
      </div>
      {editing ? (
        <DraftEditor
          proposal={proposal}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={submit}
        />
      ) : (
        <>
          {proposal.deck && <DeckPreview deck={proposal.deck} />}
          {proposal.quiz && <QuizPreview quiz={proposal.quiz} />}
          <p className="text-muted-foreground text-xs">
            Nothing is added to Study until you save it.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => submit(original)}
            >
              {save.isPending ? "Saving…" : "Save to Study"}
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

function DeckPreview({ deck }: { deck: StudyProposalDeck }) {
  return (
    <ol
      aria-label="Cards"
      className="grid max-h-64 list-decimal gap-1 overflow-y-auto pl-6 text-sm"
    >
      {deck.cards.map((card, index) => (
        <li key={index}>
          <span className="font-medium break-words">{card.front}</span>
          <span className="text-muted-foreground"> — </span>
          <span className="break-words">{card.back}</span>
        </li>
      ))}
    </ol>
  );
}

function QuizPreview({ quiz }: { quiz: StudyProposalQuiz }) {
  return (
    <ol
      aria-label="Questions"
      className="grid max-h-64 list-decimal gap-2 overflow-y-auto pl-6 text-sm"
    >
      {quiz.questions.map((question, index) => (
        <li key={index} className="grid gap-0.5">
          <span className="break-words">{question.prompt}</span>
          {question.kind === "multiple_choice" ? (
            <ul className="text-muted-foreground pl-4 text-xs">
              {(question.options ?? []).map((option, position) => (
                <li key={position}>
                  {option}
                  {position === question.correct_option && " (correct)"}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-muted-foreground text-xs break-words">
              Good answer: {question.rubric}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Edit the title and each item's text, or remove items; the answer key's shape stays. */
function DraftEditor({
  proposal,
  busy,
  onCancel,
  onSave,
}: {
  proposal: StudyProposal;
  busy: boolean;
  onCancel: () => void;
  onSave: (body: {
    deck?: StudyProposalDeck;
    quiz?: StudyProposalQuiz;
  }) => void;
}) {
  const id = useId();
  const [deck, setDeck] = useState(proposal.deck ?? null);
  const [quiz, setQuiz] = useState(proposal.quiz ?? null);
  const title = deck?.title ?? quiz?.title ?? "";
  const setTitle = (value: string) => {
    if (deck) setDeck({ ...deck, title: value });
    if (quiz) setQuiz({ ...quiz, title: value });
  };
  const items = deck?.cards.length ?? quiz?.questions.length ?? 0;
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(deck ? { deck } : { quiz: quiz ?? undefined });
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor={`${id}-title`}>Title</Label>
        <Input
          id={`${id}-title`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </div>
      {deck?.cards.map((card, index) => (
        <fieldset key={index} className="grid gap-1 border-t pt-2">
          <legend className="text-xs font-medium">Card {index + 1}</legend>
          <Label htmlFor={`${id}-front-${index}`}>Front</Label>
          <Textarea
            id={`${id}-front-${index}`}
            rows={2}
            value={card.front}
            onChange={(event) =>
              setDeck({
                ...deck,
                cards: deck.cards.map((item, at) =>
                  at === index ? { ...item, front: event.target.value } : item,
                ),
              })
            }
            required
          />
          <Label htmlFor={`${id}-back-${index}`}>Back</Label>
          <Textarea
            id={`${id}-back-${index}`}
            rows={2}
            value={card.back}
            onChange={(event) =>
              setDeck({
                ...deck,
                cards: deck.cards.map((item, at) =>
                  at === index ? { ...item, back: event.target.value } : item,
                ),
              })
            }
            required
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="justify-self-start"
            disabled={deck.cards.length === 1}
            onClick={() =>
              setDeck({
                ...deck,
                cards: deck.cards.filter((_, at) => at !== index),
              })
            }
          >
            Remove card {index + 1}
          </Button>
        </fieldset>
      ))}
      {quiz?.questions.map((question, index) => (
        <fieldset key={index} className="grid gap-1 border-t pt-2">
          <legend className="text-xs font-medium">Question {index + 1}</legend>
          <Label htmlFor={`${id}-prompt-${index}`}>Question</Label>
          <Textarea
            id={`${id}-prompt-${index}`}
            rows={2}
            value={question.prompt}
            onChange={(event) =>
              setQuiz({
                ...quiz,
                questions: quiz.questions.map((item, at) =>
                  at === index ? { ...item, prompt: event.target.value } : item,
                ),
              })
            }
            required
          />
          {question.kind === "short_answer" && (
            <>
              <Label htmlFor={`${id}-rubric-${index}`}>Good answer</Label>
              <Textarea
                id={`${id}-rubric-${index}`}
                rows={2}
                value={question.rubric ?? ""}
                onChange={(event) =>
                  setQuiz({
                    ...quiz,
                    questions: quiz.questions.map((item, at) =>
                      at === index
                        ? { ...item, rubric: event.target.value }
                        : item,
                    ),
                  })
                }
                required
              />
            </>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="justify-self-start"
            disabled={quiz.questions.length === 1}
            onClick={() =>
              setQuiz({
                ...quiz,
                questions: quiz.questions.filter((_, at) => at !== index),
              })
            }
          >
            Remove question {index + 1}
          </Button>
        </fieldset>
      ))}
      <p className="text-muted-foreground text-xs">
        {items} {deck ? "cards" : "questions"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || !title.trim()}>
          Save to Study
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
