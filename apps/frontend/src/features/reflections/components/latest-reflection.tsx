"use client";

import { Button } from "@/components/ui/button";
import { useUser } from "@/features/auth/components/user-context";
import { useQuery } from "@tanstack/react-query";
import { NotebookPenIcon } from "lucide-react";
import { reflectionHowTo, reflectionListOptions } from "../queries";
import { LEARNED_PROMPT, UNCLEAR_PROMPT } from "./reflect-dialog";

/**
 * The newest reflection on a project's Overview, or how to write one
 * (US-111.2). It reads the Reflections tab's first page, so both share a cache.
 */
export function LatestReflection({
  projectId,
  showAll,
}: {
  projectId: string;
  showAll: () => void;
}) {
  const user = useUser();
  const reflections = useQuery(
    reflectionListOptions(user.id, { projectId, page: 1 }),
  );
  // Loading and errors stay quiet here; the Reflections tab reports them.
  if (!reflections.data) return null;
  const latest = reflections.data.items[0];
  const when =
    latest &&
    new Date(latest.created_at * 1000).toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
  return (
    <section
      aria-label="Latest reflection"
      className="border-border rounded-surface flex min-w-0 items-start gap-3 border p-4"
    >
      <NotebookPenIcon
        className="text-muted-foreground mt-0.5 size-5 shrink-0"
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="text-sm font-medium">
          {latest ? `Latest reflection · ${when}` : "No reflections yet"}
        </h2>
        {latest ? (
          <dl className="flex flex-col gap-1 text-sm">
            {latest.learned && (
              <div>
                <dt className="text-muted-foreground">{LEARNED_PROMPT}</dt>
                <dd className="line-clamp-3 wrap-anywhere whitespace-pre-wrap">
                  {latest.learned}
                </dd>
              </div>
            )}
            {latest.unclear && (
              <div>
                <dt className="text-muted-foreground">{UNCLEAR_PROMPT}</dt>
                <dd className="line-clamp-3 wrap-anywhere whitespace-pre-wrap">
                  {latest.unclear}
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-muted-foreground text-sm">
            {reflectionHowTo(projectId)}
          </p>
        )}
        {latest && (
          <div>
            <Button variant="link" className="h-auto px-0" onClick={showAll}>
              {reflections.data.total > 1
                ? `All ${reflections.data.total} reflections`
                : "Open Reflections"}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
