"use client";
import { PAGE_SIZE, useFileManager } from "@/components/file-manager/context";
import { Button } from "@/components/ui/button";
import { formatPlural } from "@/lib/formatters";

export const Footer = () => {
  const { dispatch, queryParameters, totalFiles } = useFileManager();
  return (
    <div className="bg-muted text-muted-foreground flex items-center gap-2 rounded-none border-t px-4 py-2 text-xs">
      <p>{formatPlural(totalFiles, "file", "total files")}</p>

      {!!queryParameters.query?.trim() && (
        <p className="max-w-100 truncate font-bold">
          <span className="inline">Search:</span> {queryParameters.query}
        </p>
      )}
      <div className="flex flex-1 items-center justify-end gap-2">
        <p className="text-muted-foreground text-sm">
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
