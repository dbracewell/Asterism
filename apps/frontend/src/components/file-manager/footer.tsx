"use client";
import { PAGE_SIZE, useFileManager } from "@/components/file-manager/context";
import { Button } from "@/components/ui/button";
import { formatPlural } from "@/lib/formatters";

export const Footer = () => {
  const { dispatch, queryParameters, totalFiles, filesLoading, filesError } =
    useFileManager();
  if (filesLoading || filesError) return null;
  return (
    <div className="bg-muted text-muted-foreground flex min-w-0 shrink-0 flex-wrap items-center gap-2 rounded-none border-t px-4 py-2 text-xs">
      <p>{formatPlural(totalFiles, "file", "total files")}</p>

      {!!queryParameters.query?.trim() && (
        <p className="max-w-full min-w-0 truncate font-bold">
          <span className="inline">Search:</span> {queryParameters.query}
        </p>
      )}
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
        <p className="text-muted-foreground text-sm whitespace-nowrap">
          Page{" "}
          {Math.ceil(totalFiles / PAGE_SIZE) > 0 ? queryParameters.page : 0} of{" "}
          {Math.ceil(totalFiles / PAGE_SIZE)}
        </p>
        {totalFiles > PAGE_SIZE && (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={queryParameters.page === 1}
              onClick={() =>
                dispatch({ property: "page", value: queryParameters.page - 1 })
              }
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={
                queryParameters.page === Math.ceil(totalFiles / PAGE_SIZE)
              }
              onClick={() =>
                dispatch({ property: "page", value: queryParameters.page + 1 })
              }
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
