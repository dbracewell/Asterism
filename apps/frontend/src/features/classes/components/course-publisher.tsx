"use client";

import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorDetail } from "@/features/classes/error-detail";
import { client } from "@/lib/api";
import {
  classCoursePublishMutation,
  classCourseVersionGetManyOptions,
  projectGetManyOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

function count(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function formatDate(seconds: number) {
  return new Date(seconds * 1000).toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
}

/** Publish one of the educator's projects as the class course (US-60.3). */
export function CoursePublisher({ classId }: { classId: string }) {
  const projectId = useId();
  const noteId = useId();
  const [project, setProject] = useState("");
  const [note, setNote] = useState("");
  const projects = useQuery({
    ...projectGetManyOptions({
      client,
      query: { page_size: 100, sort_by: "name" },
    }),
    retry: false,
  });
  const versions = useQuery({
    ...classCourseVersionGetManyOptions({
      client,
      path: { class_id: classId },
    }),
    retry: false,
  });
  const publish = useMutation({
    ...classCoursePublishMutation({ client }),
    onSuccess: () => setNote(""),
  });
  const latest = versions.data?.items[0];
  const next = (latest?.number ?? 0) + 1;

  return (
    <section aria-label="Course" className="grid gap-3">
      <h2 className="text-lg font-medium">Course</h2>
      <p className="text-sm">
        Publish one of your projects as this class&apos;s course. Students get
        their own copy of its instructions, selected sub-agents and files, and
        choose when to take updates.
      </p>
      {projects.error && (
        <QueryError
          error={projects.error}
          message="Could not load your projects."
          retry={projects.refetch}
          isRetrying={projects.isFetching}
        />
      )}
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (project) {
            publish.mutate({
              path: { class_id: classId },
              body: { project_id: project, note: note.trim() },
            });
          }
        }}
      >
        <Field>
          <FieldLabel htmlFor={projectId}>Project to publish</FieldLabel>
          <Select value={project} onValueChange={setProject}>
            <SelectTrigger id={projectId} className="w-full md:w-md">
              <SelectValue placeholder="Choose a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.data?.projects.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            Its chats and goal date stay private. Your model choices carry over;
            tools still follow admin policy.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={noteId}>What&apos;s new (optional)</FieldLabel>
          <Textarea
            id={noteId}
            rows={2}
            maxLength={2000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <Button
          type="submit"
          className="w-fit"
          disabled={!project || publish.isPending}
        >
          Publish version {next}
        </Button>
        {publish.error && (
          <p role="alert" className="text-destructive text-sm">
            {errorDetail(publish.error, "Could not publish the course.")}
          </p>
        )}
      </form>
      {versions.error && (
        <QueryError
          error={versions.error}
          message="Could not load course versions."
          retry={versions.refetch}
          isRetrying={versions.isFetching}
        />
      )}
      {versions.data && versions.data.items.length > 0 && (
        <ul aria-label="Published versions" className="grid gap-2">
          {versions.data.items.map((version) => (
            <li key={version.id} className="border-b pb-2 text-sm">
              <p className="font-medium">
                Version {version.number}{" "}
                <span className="text-muted-foreground font-normal">
                  {formatDate(version.created_at)}
                </span>
              </p>
              {version.note && <p className="wrap-anywhere">{version.note}</p>}
              <p className="text-muted-foreground wrap-anywhere">
                {count(version.sub_agent_names.length, "sub-agent")}
                {version.sub_agent_names.length > 0 &&
                  ` (${version.sub_agent_names.join(", ")})`}
                , {count(version.file_names.length, "file")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
