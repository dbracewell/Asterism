"use client";
import { useFileManager } from "@/components/file-manager/context";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  IconFileUpload,
  IconSelectAll,
  IconSquareOff,
} from "@tabler/icons-react";
import { Grid2X2, List, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { useRef } from "react";

export const Header = ({ allowFileUpload }: { allowFileUpload: boolean }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    view,
    setView,
    sort,
    setSort,
    files,
    selectedFiles,
    setSelectedFiles,
    deleteSelectedFiles,
    query,
    setQuery,
    uploadFiles,
    setPage,
    isDeleting,
    isUploading,
  } = useFileManager();

  return (
    <div className="flex min-h-0 flex-col">
      <div className="my-2 flex flex-wrap items-center border-b py-2 pr-0.5">
        <div className="flex flex-col gap-0.5 border-l px-2">
          <div className="text-muted-foreground text-center text-xs">View</div>
          <div className="flex items-center gap-1">
            <Button
              aria-label="List view"
              onClick={() => setView("list")}
              size="icon"
              variant={view === "list" ? "link" : "ghost"}
            >
              <List size={16} />
            </Button>
            <Button
              aria-label="Icon view"
              onClick={() => setView("grid")}
              size="icon"
              variant={view === "grid" ? "link" : "ghost"}
            >
              <Grid2X2 size={16} />
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-0.5 border-l px-2">
          <div className="text-muted-foreground text-center text-xs">
            Sort by
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              aria-label="Sort by name"
              onClick={() => {
                setSort("name");
                setPage(1);
              }}
              size="sm"
              className="h-7!"
              variant={sort === "name" ? "link" : "ghost"}
            >
              Name
            </Button>
            <Button
              aria-label="Sort by kind"
              onClick={() => {
                setSort("kind");
                setPage(1);
              }}
              size="sm"
              className="h-7!"
              variant={sort === "kind" ? "link" : "ghost"}
            >
              Kind
            </Button>
            <Button
              aria-label="Sort by date"
              onClick={() => {
                setSort("date");
                setPage(1);
              }}
              size="sm"
              className="h-7!"
              variant={sort === "date" ? "link" : "ghost"}
            >
              Date
            </Button>
            <Button
              aria-label="Sort by size"
              onClick={() => {
                setSort("size");
                setPage(1);
              }}
              size="sm"
              className="h-7!"
              variant={sort === "size" ? "link" : "ghost"}
            >
              Size
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-0.5 border-x px-2">
          <div className="text-muted-foreground text-center text-xs">
            Selection
          </div>
          <div className="flex items-center gap-1">
            <Hint hint="Select all files" side="top" asChild>
              <Button
                variant="ghost"
                disabled={
                  files.length === 0 || selectedFiles.length === files.length
                }
                size="icon-lg"
                onClick={() =>
                  setSelectedFiles(files.map((file) => file.filename))
                }
              >
                <IconSelectAll />
              </Button>
            </Hint>
            <Hint hint="Clear selection" side="top" asChild>
              <Button
                onClick={() => setSelectedFiles([])}
                variant="ghost"
                size="icon-lg"
                disabled={files.length === 0 || selectedFiles.length === 0}
              >
                <IconSquareOff />
              </Button>
            </Hint>
            <Hint hint="Delete selected files" side="top" asChild>
              <Button
                variant="destructive"
                size="icon-lg"
                disabled={
                  selectedFiles.length === 0 || isDeleting || isUploading
                }
                onClick={() => deleteSelectedFiles()}
              >
                <Trash2Icon />
              </Button>
            </Hint>
            {/* {actionButton && (
              <Hint hint={actionButton.hint} side="top" asChild>
                <Button
                  variant={actionButton.variant ?? "default"}
                  className={actionButton.className}
                  size="icon-lg"
                  disabled={
                    selectedFiles.length === 0 || actionButton.isPending
                  }
                  onClick={() => {
                    actionButton.onClick(selectedFiles);
                    if (actionButton.clearSelectionAfterClick)
                      setSelectedFiles([]);
                  }}
                >
                  {actionButton.icon}
                </Button>
              </Hint>
            )} */}
          </div>
        </div>

        {allowFileUpload && (
          <div className="flex flex-col gap-0.5 border-x px-2">
            <div className="text-muted-foreground text-center text-xs">
              Upload
            </div>
            <div className="flex items-center justify-center gap-1">
              <input
                aria-label="Choose attachments"
                className="sr-only"
                multiple
                onChange={(event) => {
                  if (!!event.target.files?.length) {
                    uploadFiles(event.target.files);
                    event.target.value = "";
                  }
                }}
                ref={fileInputRef}
                type="file"
              />
              <Hint hint="Upload files" side="top" asChild>
                <Button
                  variant="ghost"
                  size="icon-lg"
                  disabled={isUploading || isDeleting}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <IconFileUpload />
                </Button>
              </Hint>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-1 items-center gap-1 border-b px-4 pb-2">
        <InputGroup>
          <InputGroupInput
            value={query ?? ""}
            aria-label="Search files"
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            disabled={files.length === 0 && !query?.trim()}
            placeholder="Search files..."
          />
          <InputGroupAddon align="inline-start">
            <SearchIcon className="text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupAddon align="inline-end">
            <Button variant="ghost" size="icon" onClick={() => setQuery(null)}>
              <XIcon />
            </Button>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  );
};
