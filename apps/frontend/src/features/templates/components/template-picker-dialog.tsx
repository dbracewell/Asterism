"use client";

import { FormSkeleton, ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TemplateDocument } from "@/lib/client";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import {
  frameworkCatalogOptions,
  templateDetailOptions,
  templateListOptions,
} from "../queries";
import { TemplateBuilder } from "./template-builder";

type Selection =
  | { source: "framework"; id: string }
  | { source: "template"; id: string };

type Props = {
  owner: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the assembled prompt after the user chooses "Use prompt". */
  onUse: (prompt: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

export function TemplatePickerDialog({
  owner,
  open,
  onOpenChange,
  onUse,
  onCloseAutoFocus,
}: Props) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const change = (next: boolean) => {
    if (!next) setSelection(null);
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent
        className="sm:max-w-4xl"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {open &&
          (selection ? (
            <SelectedTemplate
              owner={owner}
              selection={selection}
              onBack={() => setSelection(null)}
              onUse={(prompt) => {
                onUse(prompt);
                change(false);
              }}
            />
          ) : (
            <TemplateList owner={owner} onSelect={setSelection} />
          ))}
      </DialogContent>
    </Dialog>
  );
}

function TemplateList({
  owner,
  onSelect,
}: {
  owner: string;
  onSelect: (selection: Selection) => void;
}) {
  const frameworks = useQuery(frameworkCatalogOptions());
  const templates = useQuery(templateListOptions(owner));
  return (
    <>
      <DialogHeader>
        <DialogTitle>Prompt templates</DialogTitle>
        <DialogDescription>
          Pick a framework, fill in the form and watch the prompt take shape.
        </DialogDescription>
      </DialogHeader>
      <TemplateSection title="Frameworks">
        {frameworks.isPending ? (
          <ListSkeleton
            className="sm:col-span-2"
            label="Loading frameworks…"
            rows={3}
          />
        ) : frameworks.error ? (
          <SpanningError
            error={frameworks.error}
            message="Could not load frameworks."
            retry={frameworks.refetch}
            isRetrying={frameworks.isFetching}
          />
        ) : (
          frameworks.data.items.map((framework) => (
            <TemplateOption
              key={framework.id}
              name={framework.name}
              description={framework.description}
              onSelect={() =>
                onSelect({ source: "framework", id: framework.id })
              }
            />
          ))
        )}
      </TemplateSection>
      <TemplateSection title="Your templates">
        {templates.isPending ? (
          <ListSkeleton
            className="sm:col-span-2"
            label="Loading your templates…"
            rows={2}
          />
        ) : templates.error ? (
          <SpanningError
            error={templates.error}
            message="Could not load your templates."
            retry={templates.refetch}
            isRetrying={templates.isFetching}
          />
        ) : templates.data.items.length ? (
          templates.data.items.map((template) => (
            <TemplateOption
              key={template.id}
              name={template.name}
              description={template.description}
              onSelect={() => onSelect({ source: "template", id: template.id })}
            />
          ))
        ) : (
          <p className="text-muted-foreground text-xs sm:col-span-2">
            Templates you save will appear here.
          </p>
        )}
      </TemplateSection>
    </>
  );
}

function SpanningError(props: React.ComponentProps<typeof QueryError>) {
  return (
    <div className="sm:col-span-2">
      <QueryError {...props} />
    </div>
  );
}

function TemplateSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={title}>
      <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function TemplateOption({
  name,
  description,
  onSelect,
}: {
  name: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-auto min-w-0 flex-col items-start gap-0.5 py-2 text-left whitespace-normal"
      onClick={onSelect}
    >
      <span className="font-medium">{name}</span>
      <span className="text-muted-foreground font-normal">{description}</span>
    </Button>
  );
}

function SelectedTemplate({
  owner,
  selection,
  onBack,
  onUse,
}: {
  owner: string;
  selection: Selection;
  onBack: () => void;
  onUse: (prompt: string) => void;
}) {
  const frameworks = useQuery({
    ...frameworkCatalogOptions(),
    enabled: selection.source === "framework",
  });
  const detail = useQuery(
    templateDetailOptions(
      owner,
      selection.source === "template" ? selection.id : null,
    ),
  );
  const query = selection.source === "framework" ? frameworks : detail;
  const loaded: { document: TemplateDocument; revision: number } | undefined =
    selection.source === "framework"
      ? frameworks.data?.items.find((item) => item.id === selection.id)
      : detail.data;
  const back = (
    <Button type="button" variant="ghost" onClick={onBack}>
      <ArrowLeftIcon />
      Back
    </Button>
  );
  if (!loaded)
    return (
      <>
        <DialogHeader>
          <DialogTitle>Prompt template</DialogTitle>
          <DialogDescription>Loading the template.</DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <FormSkeleton label="Loading template…" fields={3} />
        ) : (
          <QueryError
            error={query.error}
            message="Could not load this template."
            retry={query.refetch}
            isRetrying={query.isFetching}
          />
        )}
        <div className="flex justify-end">{back}</div>
      </>
    );
  return (
    <>
      <DialogHeader>
        <DialogTitle>{loaded.document.name}</DialogTitle>
        <DialogDescription>{loaded.document.description}</DialogDescription>
      </DialogHeader>
      <TemplateBuilder
        key={`${selection.source}:${selection.id}:${loaded.revision}`}
        template={loaded.document}
        onUse={onUse}
        secondaryAction={back}
      />
    </>
  );
}
