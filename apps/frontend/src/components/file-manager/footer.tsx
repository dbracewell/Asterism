"use client";
import { PAGE_SIZE, useFileManager } from "@/components/file-manager/context";
import { Button } from "@/components/ui/button";
import { formatPlural } from "@/lib/formatters";

export const Footer = () => {
  const { page, setPage, total, query } = useFileManager();
  return (
    <div className="bg-muted text-muted-foreground flex items-center gap-2 rounded-none border-t px-4 py-2 text-xs">
      <p>{formatPlural(total, "file", "total files")}</p>

      {!!query?.trim() && (
        <p className="max-w-100 truncate font-bold">
          <span className="inline">Search:</span> {query}
        </p>
      )}
      <div className="flex flex-1 items-center justify-end gap-2">
        <p className="text-muted-foreground text-sm">
          Page {Math.ceil(total / PAGE_SIZE) > 0 ? page : 0} of{" "}
          {Math.ceil(total / PAGE_SIZE)}
        </p>
        {total > PAGE_SIZE && (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((current) => current - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page === Math.ceil(total / PAGE_SIZE)}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
