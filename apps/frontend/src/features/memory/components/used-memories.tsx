"use client";

import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { client } from "@/lib/api";
import type { MemoryUse } from "@/lib/client";
import { memoryGetOneOptions } from "@/lib/client/@tanstack/react-query.gen";
import { memoryHref } from "../lib";

/**
 * The memories a reply was given (ADR-0078). The run records ids and revisions
 * only; each memory's text is read live, so a deleted one shows as deleted.
 */
export function UsedMemories({
  memories,
  enabled,
  titleClassName,
}: {
  memories: MemoryUse[] | undefined;
  enabled: boolean;
  titleClassName?: string;
}) {
  const used = memories ?? [];
  const results = useQueries({
    queries: used.map((use) => ({
      ...memoryGetOneOptions({ client, path: { memory_id: use.id } }),
      enabled,
      retry: false,
    })),
  });
  if (used.length === 0) return null;
  return (
    <section aria-label="Memories" className="flex min-w-0 flex-col gap-1.5">
      <h4 className={titleClassName}>Memories</h4>
      <ul aria-label="Memories used" className="flex flex-col gap-1">
        {used.map((use, index) => {
          const result = results[index];
          const memory = result?.data;
          return (
            <li key={use.id} className="min-w-0 [overflow-wrap:anywhere]">
              {memory ? (
                <>
                  <Link className="underline" href={memoryHref(memory)}>
                    {memory.text}
                  </Link>
                  {memory.revision !== use.revision && (
                    <span className="text-muted-foreground">
                      {" "}
                      (edited since)
                    </span>
                  )}
                </>
              ) : result?.isError ? (
                <span className="text-muted-foreground">
                  A memory you&apos;ve deleted since
                </span>
              ) : (
                <span className="text-muted-foreground">Loading…</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
