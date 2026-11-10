"use client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, client } from "@/lib/api";
import type { CanvasVersion } from "@/lib/client";
import { canvasVersionSaveToLibraryMutation } from "@/lib/client/@tanstack/react-query.gen";
import { isErrorDetail } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import React from "react";
import { toast } from "sonner";
import {
  EXPORT_FORMATS,
  downloadName,
  formatLabel,
  saveBlob,
  type CanvasExportFormat,
} from "../lib/canvas";

const failure = (error: unknown, fallback: string) =>
  isErrorDetail(error) && typeof error.detail === "string"
    ? error.detail
    : fallback;

async function download(
  request: () => Promise<{ data?: unknown; response?: Response }>,
  fallback: string,
) {
  const { data, response } = await request();
  if (!(data instanceof Blob)) throw new Error("The download is unavailable");
  saveBlob(
    data,
    downloadName(response?.headers.get("content-disposition"), fallback),
  );
}

/**
 * Downloads, made on the server: the viewed version in each of its kind's
 * formats, a copy in the file library, or every item in the chat as a ZIP.
 */
export function CanvasDownloads({
  chatId,
  version,
}: {
  chatId: string;
  version: CanvasVersion;
}) {
  const [busy, setBusy] = React.useState(false);
  const save = useMutation(canvasVersionSaveToLibraryMutation({ client }));
  const path = {
    chat_id: chatId,
    item_id: version.item_id,
    number: version.number,
  };
  const formats = EXPORT_FORMATS[version.kind];

  const run = async (task: () => Promise<void>, error: string) => {
    setBusy(true);
    try {
      await task();
    } catch (cause) {
      toast.error(failure(cause, error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Download or save"
          aria-busy={busy || save.isPending}
          disabled={busy || save.isPending}
        >
          <DownloadIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            Download version {version.number}
          </DropdownMenuLabel>
          {formats.map((format) => (
            <DropdownMenuItem
              key={`download-${format}`}
              onSelect={() =>
                run(
                  () =>
                    download(
                      () =>
                        api.canvasVersionExport({
                          path,
                          query: { format },
                          parseAs: "blob",
                        }),
                      `canvas.${format}`,
                    ),
                  "Could not download the canvas item.",
                )
              }
            >
              {formatLabel(format, version.language)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Save to my files</DropdownMenuLabel>
          {formats.map((format: CanvasExportFormat) => (
            <DropdownMenuItem
              key={`save-${format}`}
              onSelect={() =>
                save.mutate(
                  { path, body: { format } },
                  {
                    onSuccess: (file) =>
                      toast.success(`Saved ${file.filename} to your files`),
                    onError: (error) =>
                      toast.error(
                        failure(error, "Could not save to your files."),
                      ),
                  },
                )
              }
            >
              {formatLabel(format, version.language)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            run(
              () =>
                download(
                  () =>
                    api.canvasExportZip({
                      path: { chat_id: chatId },
                      parseAs: "blob",
                    }),
                  "canvas.zip",
                ),
              "Could not download the canvas items.",
            )
          }
        >
          All canvas items in this chat (.zip)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
