"use client";

import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { errorDetail } from "@/features/classes/error-detail";
import { client } from "@/lib/api";
import type { CourseChange, CourseOffer } from "@/lib/client";
import {
  classCourseApplyMutation,
  classCourseGetOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { formatFileSize } from "@/lib/formatters";
import { useMutation, useQuery } from "@tanstack/react-query";
import { HelpTopic } from "@/features/help/components/help-topic";
import Link from "next/link";

const CHANGE_VERB: Record<CourseChange["kind"], string> = {
  added: "Added",
  removed: "Removed",
  changed: "Updated",
};
const CHANGE_ITEM: Record<CourseChange["item"], string> = {
  settings: "",
  sub_agent: "sub-agent",
  file: "file",
};

function changeText(change: CourseChange) {
  if (change.item === "settings") return `${change.name} updated`;
  return `${CHANGE_VERB[change.kind]} ${CHANGE_ITEM[change.item]} ${change.name}`;
}

/** Everything the student agrees to by adding or updating. */
function OfferSummary({ offer }: { offer: CourseOffer }) {
  return (
    <div className="grid gap-2 text-sm">
      {offer.note && (
        <p className="wrap-anywhere">
          <span className="font-medium">From your educator:</span> {offer.note}
        </p>
      )}
      {offer.sub_agents.length > 0 && (
        <div className="grid gap-1">
          <p className="font-medium">Sub-agents</p>
          <ul className="grid gap-1">
            {offer.sub_agents.map((agent) => (
              <li key={agent.name} className="wrap-anywhere">
                {agent.name} —{" "}
                {agent.model_name ?? (
                  <span className="text-destructive">
                    model not available to you
                  </span>
                )}
                {agent.tools.length > 0 &&
                  `, can use ${agent.tools.join(", ")}`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {offer.files.length > 0 && (
        <div className="grid gap-1">
          <p className="font-medium">Files</p>
          <ul className="grid gap-1">
            {offer.files.map((file) => (
              <li key={file.name} className="wrap-anywhere">
                {file.name}{" "}
                <span className="text-muted-foreground">
                  ({formatFileSize(file.size)})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {offer.instructions && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="link" className="h-auto p-0">
              Show course instructions
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="bg-muted rounded-surface mt-2 p-3 wrap-anywhere whitespace-pre-wrap">
              {offer.instructions}
            </p>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

/** A joined class's course: add it, open it, or update it (US-60.3). */
export function ClassCourse({
  classId,
  courseName,
}: {
  classId: string;
  courseName: string;
}) {
  const course = useQuery({
    ...classCourseGetOptions({ client, path: { class_id: classId } }),
    retry: false,
  });
  const apply = useMutation(classCourseApplyMutation({ client }));

  if (course.isPending) {
    return <Skeleton className="h-6 w-48" />;
  }
  if (course.error) {
    return (
      <QueryError
        error={course.error}
        message="Could not load the course."
        retry={course.refetch}
        isRetrying={course.isFetching}
      />
    );
  }
  const offer = course.data;
  if (!offer) {
    return (
      <p className="text-muted-foreground text-sm">
        Your educator hasn&apos;t published a course yet.
      </p>
    );
  }
  const current = offer.current;
  const upToDate =
    current?.version_number === offer.version_number && current.project_id;
  const blocked = offer.sub_agents.some((agent) => agent.model_name === null);
  const action = !current
    ? "Add course"
    : !current.project_id
      ? "Add course again"
      : `Update to version ${offer.version_number}`;

  return (
    <section
      aria-label={`${courseName} course`}
      className="grid gap-3 border-t pt-3"
    >
      {upToDate ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p>You have the latest course (version {offer.version_number}).</p>
          <Button asChild variant="outline">
            <Link href={`/projects/${current.project_id}`}>
              Open course project
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <p className="text-sm font-medium">
              {!current
                ? `Course available (version ${offer.version_number})`
                : !current.project_id
                  ? "You deleted the course project. You can add it again."
                  : `Version ${offer.version_number} is available. You have version ${current.version_number}.`}
            </p>
            <HelpTopic id="concept.course" />
          </div>
          {offer.changes.length > 0 && (
            <ul aria-label="What changed" className="grid gap-1 text-sm">
              {offer.changes.map((change) => (
                <li
                  key={`${change.kind}-${change.item}-${change.name}`}
                  className="wrap-anywhere"
                >
                  {changeText(change)}
                </li>
              ))}
            </ul>
          )}
          <OfferSummary offer={offer} />
          <p className="text-muted-foreground text-sm">
            {current
              ? "Updating replaces the course's sub-agents, files and instructions with your educator's new version. Your chats are kept."
              : "This adds a project with these sub-agents and files to your account. They're your own copies; your educator can't see your chats."}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              className="w-fit"
              disabled={apply.isPending || Boolean(blocked)}
              onClick={() =>
                apply.mutate({
                  path: { class_id: classId },
                  body: { version_number: offer.version_number },
                })
              }
            >
              {action}
            </Button>
            {current?.project_id && (
              <Button asChild variant="outline">
                <Link href={`/projects/${current.project_id}`}>
                  Open course project
                </Link>
              </Button>
            )}
          </div>
          {blocked && (
            <p role="alert" className="text-destructive text-sm">
              A course model isn&apos;t available to you. Ask your educator or
              an administrator.
            </p>
          )}
        </>
      )}
      {apply.error && (
        <p role="alert" className="text-destructive text-sm">
          {errorDetail(apply.error, "Could not add the course.")}
        </p>
      )}
    </section>
  );
}
