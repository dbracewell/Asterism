"use client";

import { ListSkeleton } from "@/components/loading-skeletons";
import { useConfirmationDialog } from "@/components/confirmation-dialog";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { client } from "@/lib/api";
import type { SkillAssignments } from "@/lib/client";
import { mainAgentSkillsUpdateMutation } from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  skillAssignmentsOptions,
  skillMutationInvalidates,
  skillsListOptions,
} from "../queries";
import { SkillAvailability, SkillFailure } from "./skill-status";

export function MainAgentSkills({ owner }: { owner: string }) {
  return <OwnedMainAgentSkills key={owner} owner={owner} />;
}

function OwnedMainAgentSkills({ owner }: { owner: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open}>
      <DialogTrigger asChild>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Manage main-agent skills
        </Button>
      </DialogTrigger>
      {open && <AssignmentDialog owner={owner} close={() => setOpen(false)} />}
    </Dialog>
  );
}

function AssignmentDialog({
  owner,
  close,
}: {
  owner: string;
  close: () => void;
}) {
  const assignments = useQuery(skillAssignmentsOptions(owner));
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const skills = useQuery(skillsListOptions(owner, query, page));
  const [draft, setDraft] = useState<SkillAssignments | null>(null);
  const [reloading, setReloading] = useState(false);
  const mutation = useMutation({
    ...mainAgentSkillsUpdateMutation({ client }),
    meta: { invalidates: skillMutationInvalidates() },
  });
  const selection = draft ?? assignments.data;
  const changed =
    !!draft && !!assignments.data && assignments.data.revision > draft.revision;
  const dirty = !!draft;
  const busy = mutation.isPending || reloading;
  const discard = useConfirmationDialog({
    title: "Discard assignment changes?",
    description: "Your pending skill selections will be lost.",
    confirmText: "Discard changes",
    confirmVariant: "destructive",
  });
  const requestClose = async () => {
    if (!busy && (!dirty || (await discard.confirm()))) close();
  };
  const lastPage = skills.data
    ? Math.max(1, Math.ceil(skills.data.total / 10))
    : page;
  if (page > lastPage) setPage(lastPage);
  return (
    <DialogContent
      showCloseButton={false}
      className="sm:max-w-2xl"
      onEscapeKeyDown={(event) => {
        event.preventDefault();
        void requestClose();
      }}
      onInteractOutside={(event) => {
        event.preventDefault();
      }}
    >
      <DialogHeader>
        <DialogTitle>Main-agent skills</DialogTitle>
        <DialogDescription>
          Choose up to 100 private skills. Assignments are separate from tools,
          instructions, and chat activation.
        </DialogDescription>
      </DialogHeader>
      {discard.dialog}
      <SkillAvailability owner={owner} />
      {assignments.isPending && (
        <ListSkeleton label="Loading skill assignments…" rows={2} />
      )}
      {assignments.error && (
        <QueryError
          error={assignments.error}
          message={
            assignments.data
              ? "Could not refresh assignments. Your selections are retained."
              : "Could not load skill assignments."
          }
          retry={assignments.refetch}
          isRetrying={assignments.isFetching}
        />
      )}
      {changed && (
        <p role="status">
          Main-agent settings or assignments changed. Reload current assignments
          before saving; your pending selections are retained.
        </p>
      )}
      <Field>
        <FieldLabel htmlFor="assignment-search">
          Find skills to assign
        </FieldLabel>
        <Input
          id="assignment-search"
          maxLength={200}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
      </Field>
      {skills.isPending && (
        <ListSkeleton label="Loading owned skills…" rows={3} />
      )}
      {skills.error && (
        <QueryError
          error={skills.error}
          message="Could not load owned skills. Existing selections are retained."
          retry={skills.refetch}
          isRetrying={skills.isFetching}
        />
      )}
      {skills.data?.total === 0 && (
        <p>
          {query
            ? "No matching skills."
            : "Create skills in User Settings → Skills before assigning them."}
        </p>
      )}
      {selection && (
        <>
          <p role="status">
            {selection.skill_ids.length} assigned. Selections on other pages are
            retained.
          </p>
          <FieldGroup>
            {skills.data?.items.map((skill) => {
              const checked = selection.skill_ids.includes(skill.id);
              return (
                <Field key={skill.id} orientation="horizontal">
                  <Checkbox
                    id={`assign-${skill.id}`}
                    checked={checked}
                    disabled={
                      busy || (!checked && selection.skill_ids.length >= 100)
                    }
                    onCheckedChange={(value) => {
                      const ids = new Set(selection.skill_ids);
                      if (value === true) ids.add(skill.id);
                      else ids.delete(skill.id);
                      setDraft({
                        revision: selection.revision,
                        skill_ids: [...ids],
                      });
                    }}
                  />
                  <FieldLabel
                    htmlFor={`assign-${skill.id}`}
                    className="min-w-0 flex-1 wrap-anywhere"
                  >
                    {skill.name}
                    <span className="text-muted-foreground block">
                      {skill.description}
                    </span>
                  </FieldLabel>
                </Field>
              );
            })}
          </FieldGroup>
        </>
      )}
      {skills.data && skills.data.total > 10 && (
        <nav
          aria-label="Assignment skill pages"
          className="flex flex-wrap items-center justify-end gap-2"
        >
          <Button
            variant="outline"
            disabled={page === 1 || skills.isFetching}
            onClick={() => setPage(page - 1)}
          >
            Previous skills
          </Button>
          <span>
            Page {page} of {lastPage}
          </span>
          <Button
            variant="outline"
            disabled={page === lastPage || skills.isFetching}
            onClick={() => setPage(page + 1)}
          >
            Next skills
          </Button>
        </nav>
      )}
      {mutation.error && (
        <SkillFailure
          error={mutation.error}
          title="Could not save skill assignments"
        />
      )}
      <footer className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          disabled={busy || assignments.isFetching}
          onClick={async () => {
            if (dirty && !(await discard.confirm())) return;
            setReloading(true);
            try {
              const result = await assignments.refetch();
              if (!result.error && result.data) {
                setDraft(null);
                mutation.reset();
              }
            } finally {
              setReloading(false);
            }
          }}
        >
          Reload current assignments
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void requestClose()}
        >
          Cancel
        </Button>
        <Button
          disabled={!draft || busy || changed || !selection}
          onClick={async () => {
            if (!draft || changed) return;
            try {
              await mutation.mutateAsync({
                body: {
                  skill_ids: draft.skill_ids,
                  expected_revision: draft.revision,
                },
              });
              toast.success("Skill assignments saved");
              close();
            } catch {
              /* Keep pending selections and their original revision. */
            }
          }}
        >
          {mutation.isPending ? "Saving…" : "Save assignments"}
        </Button>
      </footer>
    </DialogContent>
  );
}
