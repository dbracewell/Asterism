"use client";

import { useConfirmationDialog } from "@/components/confirmation-dialog";
import MarkdownViewer from "@/components/markdown-viewer";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { Button } from "@/components/ui/button";
import {
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { client } from "@/lib/api";
import type { StudySummaryDraft, StudySummaryRequest } from "@/lib/client";
import { studySummaryGenerateMutation } from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { studyErrorDetail } from "../lib/error-detail";
import { CardCitations } from "./card-citations";
import { SaveNote } from "./save-note";
import {
  SourceFilesFieldset,
  StudyModelField,
  useSourceFiles,
  useStudyModel,
} from "./source-fields";
import { PendingStatus } from "./pending-status";

type Depth = StudySummaryRequest["depth"];

export const DEPTHS: { value: Depth; label: string; description: string }[] = [
  {
    value: "simple",
    label: "Simple",
    description: "Plain words and examples, for a first pass.",
  },
  {
    value: "standard",
    label: "Standard",
    description: "Key ideas and definitions, for revision.",
  },
  {
    value: "expert",
    label: "Expert",
    description: "Dense and precise, with formulas and edge cases.",
  },
];

export function SummaryGenerate({ projectId }: { projectId: string }) {
  const [draft, setDraft] = useState<StudySummaryDraft | null>(null);
  // A new draft resets the save form, including an edited title.
  const [version, setVersion] = useState(0);
  const generate = useMutation({
    ...studySummaryGenerateMutation({ client }),
    // Drafting changes nothing on the server.
    meta: { skipGlobalInvalidation: true },
    onSuccess: (result) => {
      setDraft(result);
      setVersion((current) => current + 1);
    },
  });
  const { confirm, dialog } = useConfirmationDialog({
    title: "Replace this summary?",
    description: "The current summary has not been saved and will be lost.",
    confirmText: "Summarize again",
  });
  return (
    <PageLayout>
      <Link
        href={`/projects/${projectId}?tab=study`}
        className="text-muted-foreground text-sm hover:underline"
      >
        Back to project
      </Link>
      <PageHeader
        title="Summarize files"
        description="Summarize this project's files at the depth you need. Each section cites its source; nothing is saved until you save it as a note."
      />
      <SummaryForm
        projectId={projectId}
        pending={generate.isPending}
        onSubmit={async (body) => {
          if (draft && draft.sections.length > 0 && !(await confirm())) return;
          generate.mutate({ path: { project_id: projectId }, body });
        }}
      />
      {generate.isPending && (
        <PendingStatus>
          Summarizing. This can take a minute or two.
        </PendingStatus>
      )}
      {generate.error && (
        <p role="alert" className="text-destructive text-sm">
          {studyErrorDetail(generate.error, "Could not summarize. Try again.")}
        </p>
      )}
      {draft && !generate.isPending && (
        <SummaryDraftView key={version} projectId={projectId} draft={draft} />
      )}
      {dialog}
    </PageLayout>
  );
}

function SummaryForm({
  projectId,
  pending,
  onSubmit,
}: {
  projectId: string;
  pending: boolean;
  onSubmit: (body: StudySummaryRequest) => void;
}) {
  const [depth, setDepth] = useState<Depth>("standard");
  const source = useSourceFiles(projectId);
  const choice = useStudyModel();
  const { model } = choice;
  const valid = !!model && source.valid;
  return (
    <form
      className="rounded-surface flex flex-col gap-5 border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || !model) return;
        onSubmit({ model_id: model, depth, file_ids: source.fileIds });
      }}
    >
      <FieldGroup>
        <SourceFilesFieldset
          idPrefix="summary"
          disabled={pending}
          source={source}
        />
        <FieldSet>
          <FieldLegend variant="label">Depth</FieldLegend>
          <RadioGroup
            value={depth}
            onValueChange={(value) => setDepth(value as Depth)}
            disabled={pending}
          >
            {DEPTHS.map((item) => (
              <div key={item.value} className="flex items-start gap-2">
                <RadioGroupItem
                  value={item.value}
                  id={`summary-depth-${item.value}`}
                  aria-describedby={`summary-depth-${item.value}-description`}
                  className="mt-0.5"
                />
                <div className="flex flex-col">
                  <Label htmlFor={`summary-depth-${item.value}`}>
                    {item.label}
                  </Label>
                  <FieldDescription
                    id={`summary-depth-${item.value}-description`}
                  >
                    {item.description}
                  </FieldDescription>
                </div>
              </div>
            ))}
          </RadioGroup>
        </FieldSet>
        <StudyModelField
          id="summary-model"
          disabled={pending}
          choice={choice}
        />
      </FieldGroup>
      <div>
        <Button type="submit" disabled={pending || !valid}>
          {pending ? "Summarizing…" : "Summarize"}
        </Button>
      </div>
    </form>
  );
}

function SummaryDraftView({
  projectId,
  draft,
}: {
  projectId: string;
  draft: StudySummaryDraft;
}) {
  return (
    <>
      <section aria-label="File results" className="flex flex-col gap-2">
        <h2 className="text-heading">Files</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {draft.files.map((file) => (
            <li
              key={file.file_id}
              className="flex flex-wrap items-baseline gap-2"
            >
              <span className="font-medium">
                {file.file_name ?? "Unavailable file"}
              </span>
              {file.status === "used" ? (
                <span className="text-muted-foreground">
                  {file.section_count === 1
                    ? "1 section"
                    : `${file.section_count} sections`}
                  {file.truncated && ". Only the start of this file was used."}
                </span>
              ) : (
                <span className="text-destructive">{file.message}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
      {draft.sections.length === 0 ? (
        <p role="alert" className="text-destructive text-sm">
          No summary was produced. Check the file results above and try again.
        </p>
      ) : (
        <>
          <section aria-label="Summary" className="flex flex-col gap-4">
            <h2 className="text-heading">Summary</h2>
            {draft.sections.map((section, index) => (
              <article
                key={index}
                aria-label={section.heading}
                className="rounded-surface flex flex-col gap-2 border p-4"
              >
                <p className="text-muted-foreground text-xs">
                  {section.file_name ?? "Unavailable file"}
                </p>
                <h3 className="font-medium">{section.heading}</h3>
                {/* Generated text is untrusted. */}
                <MarkdownViewer content={section.text} className="text-sm" />
                <CardCitations citations={section.citations} />
              </article>
            ))}
          </section>
          <SaveNote
            projectId={projectId}
            kind="summary"
            defaultTitle={draft.title}
            body={draft.body}
            citations={draft.citations}
            modelId={draft.model_id}
          />
        </>
      )}
    </>
  );
}
