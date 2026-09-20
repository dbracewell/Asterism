"use client";

import { APIDownload } from "@/components/api-download";
import { APIImage } from "@/components/api-image";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { UserFile } from "@/lib/client";
import { cn } from "cn";
import { FileIcon, Grid2X2, List, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type View = "list" | "grid";
type Sort = "name" | "kind";

const PAGE_SIZE = 25;

export function FileManager() {
  const [files, setFiles] = useState<UserFile[]>([]);
  const [view, setView] = useState<View>("list");
  const [sort, setSort] = useState<Sort>("name");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.fileGetMany({
        query: { page, page_size: PAGE_SIZE },
      });
      setFiles(data?.files ?? []);
      setTotal(data?.total ?? 0);
    } catch {
      setError("Unable to load your files.");
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const ordered = useMemo(
    () =>
      [...files].sort((a, b) =>
        sort === "name"
          ? a.original_name.localeCompare(b.original_name)
          : a.kind.localeCompare(b.kind) ||
            a.original_name.localeCompare(b.original_name),
      ),
    [files, sort],
  );
  const remove = async (file: UserFile) => {
    try {
      await api.fileDelete({ path: { filename: file.filename } });
      setFiles((current) => current.filter((item) => item.id !== file.id));
    } catch {
      setError(`Unable to delete ${file.original_name}.`);
    }
  };

  return (
    <main className="mx-auto mt-12 w-full max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Files</h1>
          <p className="text-muted-foreground">Your uploaded files</p>
        </div>
        <div className="flex gap-2">
          <Button
            aria-label="Sort by name"
            onClick={() => setSort("name")}
            size="sm"
            variant={sort === "name" ? "default" : "outline"}
          >
            Name
          </Button>
          <Button
            aria-label="Sort by kind"
            onClick={() => setSort("kind")}
            size="sm"
            variant={sort === "kind" ? "default" : "outline"}
          >
            Kind
          </Button>
          <Button
            aria-label="List view"
            onClick={() => setView("list")}
            size="icon"
            variant={view === "list" ? "default" : "outline"}
          >
            <List size={16} />
          </Button>
          <Button
            aria-label="Icon view"
            onClick={() => setView("grid")}
            size="icon"
            variant={view === "grid" ? "default" : "outline"}
          >
            <Grid2X2 size={16} />
          </Button>
        </div>
      </div>
      {error && (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      )}
      {!ordered.length ? (
        <p className="text-muted-foreground">No uploaded files yet.</p>
      ) : (
        <div
          className={
            view === "grid"
              ? "grid grid-cols-2 gap-3 sm:grid-cols-4"
              : "divide-y rounded-lg border"
          }
        >
          {ordered.map((file) => (
            <article
              className={cn(
                "relative min-h-0",
                view === "grid"
                  ? "space-y-2 rounded-lg border p-3"
                  : "flex items-center gap-3 p-3",
              )}
              key={file.id}
            >
              {file.kind === "image" ? (
                <APIImage
                  className={cn(
                    "shrink-0 rounded object-cover",
                    view === "grid" && "mx-auto",
                  )}
                  filename={file.filename}
                  alt={file.original_name}
                  width={view === "grid" ? 128 : 32}
                  height={view === "grid" ? 128 : 32}
                />
              ) : (
                <div className="relative">
                  <FileIcon
                    className={cn(
                      "text-muted-foreground shrink-0",
                      view === "grid" ? "mx-auto h-32 w-32" : "h-8 w-8",
                    )}
                  />
                  {view === "grid" && (
                    <p className="text-muted-foreground absolute right-0 bottom-1/2 left-0 translate-y-1/2 truncate px-1 text-center text-xs font-black select-none">
                      {file.filename
                        .slice(file.filename.lastIndexOf(".") + 1)
                        .toUpperCase()}{" "}
                    </p>
                  )}
                </div>
              )}

              <div className="flex min-w-0 flex-1 flex-col">
                <APIDownload
                  className="text-sm underline"
                  filename={file.filename}
                />
                <p className="text-muted-foreground text-xs capitalize">
                  {file.kind} · {file.size} bytes
                </p>
              </div>

              <Button
                aria-label={`Delete ${file.original_name}`}
                onClick={() => void remove(file)}
                size="icon"
                variant="ghost"
                className={cn(
                  "hover:bg-destructive/10 top-2 right-0",
                  view === "grid" && "absolute",
                )}
              >
                <Trash2 size={16} />
              </Button>
            </article>
          ))}
        </div>
      )}
      {total > PAGE_SIZE && (
        <nav
          aria-label="File pages"
          className="flex items-center justify-end gap-2"
        >
          <span className="text-muted-foreground text-sm">
            Page {page} of {Math.ceil(total / PAGE_SIZE)}
          </span>
          <Button
            disabled={page === 1}
            onClick={() => setPage((current) => current - 1)}
            variant="outline"
          >
            Previous
          </Button>
          <Button
            disabled={page * PAGE_SIZE >= total}
            onClick={() => setPage((current) => current + 1)}
            variant="outline"
          >
            Next
          </Button>
        </nav>
      )}
    </main>
  );
}
