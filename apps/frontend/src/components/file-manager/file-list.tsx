"use client";
import { APIDownload } from "@/components/api-download";
import { APIImage } from "@/components/api-image";
import { useFileManager } from "@/components/file-manager/context";
import { KnowledgeStatus } from "@/components/file-manager/knowledge-status";
import { buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatFileSize } from "@/lib/formatters";
import { cn } from "cn";
import { ExternalLink, FileIcon } from "lucide-react";
import Link from "next/link";

export const FileList = () => {
  const {
    files,
    view,
    selectedFiles,
    isSelectable,
    toggleSelect,
    filesLoading,
    mode,
  } = useFileManager();

  if (filesLoading) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col gap-2">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {files.length === 0 ? (
        <section className="text-muted-foreground bg-card flex flex-1 items-center justify-center text-lg">
          No files found.
        </section>
      ) : (
        <div className="bg-card flex min-h-0 w-full min-w-0 flex-1 flex-col">
          <div
            className={cn(
              "min-h-0 w-full min-w-0 gap-1 overflow-y-auto px-4 py-2",
              view === "grid"
                ? "grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] grid-rows-[fit-content(200px)] gap-3"
                : "flex flex-col",
            )}
          >
            {files.map((file, index) => (
              <article
                key={file.id}
                onClick={(e) => {
                  e.stopPropagation();
                  if ((e.target as HTMLElement).closest("a, button")) return;
                  toggleSelect(
                    file.filename,
                    index,
                    e.shiftKey,
                    e.ctrlKey || e.metaKey,
                  );
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    toggleSelect(
                      file.filename,
                      index,
                      e.shiftKey,
                      e.ctrlKey || e.metaKey,
                    );
                  }
                }}
                className={cn(
                  "hover:bg-accent/50 hover:text-accent-foreground flex items-center gap-1 rounded-lg p-2 select-none focus:outline-none",
                  view === "grid"
                    ? "bg-background text-foreground flex-col border"
                    : index % 2 === 1 && "bg-background text-foreground",
                  selectedFiles.includes(file.filename) &&
                    "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground",
                  !isSelectable(file) && "opacity-60",
                )}
              >
                {file.kind === "image" ? (
                  <APIImage
                    className="shrink-0 rounded object-cover"
                    filename={file.filename}
                    alt={file.original_name}
                    width={view === "grid" ? 64 : 32}
                    height={view === "grid" ? 64 : 32}
                  />
                ) : (
                  <div className="relative">
                    <FileIcon
                      className={cn(
                        "text-muted-foreground shrink-0",
                        view === "grid" ? "size-16" : "size-8",
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
                <div
                  className={cn(
                    "flex w-full min-w-0 flex-1 flex-col text-sm",
                    view === "grid" ? "text-center" : "ml-4 justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center gap-2",
                      view === "grid" && "justify-between",
                    )}
                  >
                    <h4
                      className={cn(
                        "truncate",
                        view === "grid" && "flex-1 text-center",
                      )}
                    >
                      {file.original_name}
                    </h4>
                  </div>
                  <div className="text-muted-foreground flex w-full items-center gap-4 truncate text-xs capitalize">
                    <span
                      className={cn(
                        view === "grid" && "flex-1 text-center",
                        view === "grid" && mode === "normal" && "-mr-10",
                      )}
                    >
                      {file.kind} · {formatFileSize(file.size, 2, false)}
                      {!isSelectable(file) && (
                        <>
                          <br /> Already in this knowledge base
                        </>
                      )}
                    </span>
                    {mode === "normal" && (
                      <div className="flex items-center gap-1">
                        <Link
                          href={`/files/${encodeURIComponent(file.filename)}`}
                          aria-label={`Open ${file.original_name}`}
                          className={buttonVariants({
                            variant: "ghost",
                            size: "icon-xs",
                            className: "shrink-0",
                          })}
                        >
                          <ExternalLink />
                        </Link>
                        <APIDownload
                          className="text-sm font-bold"
                          filename={file.filename}
                          linkText="[↓]"
                        />
                      </div>
                    )}
                  </div>
                </div>
                {mode === "normal" && (
                  <KnowledgeStatus
                    filename={file.filename}
                    knowledgeBaseCount={file.knowledge_base_count ?? 0}
                  />
                )}
              </article>
            ))}
          </div>
          <div className="flex flex-1" />
        </div>
      )}
    </div>
  );
};
