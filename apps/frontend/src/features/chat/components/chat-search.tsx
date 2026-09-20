"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { client } from "@/lib/api";
import { chatSearchOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import { FolderIcon, MessageSquareIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useEffect, useState } from "react";

const PAGE_SIZE = 20;

export const ChatSearch = () => {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query.trim());
  const enabled = deferredQuery.length > 0;
  const { data, isFetching, error } = useQuery({
    ...chatSearchOptions({
      client,
      query: { q: deferredQuery, page, page_size: PAGE_SIZE },
    }),
    enabled,
  });

  useEffect(() => setPage(1), [deferredQuery]);

  return (
    <main className="container mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 p-4 pt-16">
      <div>
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="text-muted-foreground text-sm">
          Find chats and folders by name or conversation content.
        </p>
      </div>
      <div className="relative">
        <SearchIcon className="text-muted-foreground absolute top-1/2 left-2 size-4 -translate-y-1/2" />
        <Input
          aria-label="Search chats and folders"
          autoFocus
          className="h-10 pl-8 text-sm"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search chats and folders"
          value={query}
        />
      </div>
      {!enabled && (
        <p className="text-muted-foreground text-sm">
          Enter one or more keywords to search your chats and folders.
        </p>
      )}
      {isFetching && (
        <div className="mx-auto">
          <Spinner />
        </div>
      )}
      {error && (
        <p className="text-destructive text-sm" role="alert">
          Unable to search right now. Please try again.
        </p>
      )}
      {enabled && !isFetching && data?.results.length === 0 && (
        <p className="text-muted-foreground text-sm">No matches found.</p>
      )}
      {data?.results.map((result) => {
        const content = (
          <>
            <div className="flex items-center gap-2 font-medium">
              {result.kind === "chat" ? (
                <MessageSquareIcon className="size-4" />
              ) : (
                <FolderIcon className="size-4" />
              )}
              <span className="truncate">{result.title}</span>
            </div>
            <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
              {result.snippet}
            </p>
            {(result.path?.length ?? 0) > 0 && (
              <p className="text-muted-foreground mt-2 text-xs">
                {result.path?.join(" / ")}
              </p>
            )}
            <p className="text-muted-foreground mt-2 text-xs">
              {result.kind === "chat"
                ? result.match_source === "title"
                  ? "Chat title"
                  : "Chat content"
                : result.match_source === "folder_title"
                  ? "Folder name"
                  : "Contains a matching chat"}
            </p>
          </>
        );
        return result.kind === "chat" ? (
          <Link
            className="hover:bg-accent rounded-lg border p-3 transition-colors"
            href={`/c/${result.id}`}
            key={`${result.kind}-${result.id}`}
          >
            {content}
          </Link>
        ) : (
          <div
            className="rounded-lg border p-3"
            key={`${result.kind}-${result.id}`}
          >
            {content}
          </div>
        );
      })}
      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm">{data.total} results</p>
          <div className="flex gap-2">
            <Button
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
              variant="outline"
            >
              Previous
            </Button>
            <Button
              disabled={page * PAGE_SIZE >= data.total}
              onClick={() => setPage((value) => value + 1)}
              variant="outline"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </main>
  );
};
