"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/features/settings/ui/settings-section";
import { client } from "@/lib/api";
import {
  dataExportCreateMutation,
  dataExportGetOptions,
  dataExportLinkCreateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { formatFileSize } from "@/lib/formatters";
import { errorDetail } from "@/lib/utils";

const POLL_MS = 3_000;

function day(seconds: number) {
  return new Date(seconds * 1000).toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
}

/** Download my data: one archive of everything this account holds (US-86.8). */
export function DownloadMyData() {
  const state = useQuery({
    ...dataExportGetOptions({ client }),
    refetchInterval: (query) => {
      const status = query.state.data?.export?.status;
      return status === "pending" || status === "running" ? POLL_MS : false;
    },
  });
  const prepare = useMutation(dataExportCreateMutation({ client }));
  const download = useMutation({
    ...dataExportLinkCreateMutation({ client }),
    meta: { skipGlobalInvalidation: true },
    // A plain navigation streams the archive to disk, however large.
    onSuccess: (link) => window.location.assign(link.url),
  });
  const current = state.data?.export ?? null;
  const busy = current?.status === "pending" || current?.status === "running";
  const failure = prepare.error ?? download.error ?? state.error;

  return (
    <SettingsSection
      title="Your data"
      description="One archive of your chats, files, projects, study records, skills, About you, memories and settings. Chats come as readable Markdown and as JSON."
    >
      <div className="grid gap-2 text-sm">
        {busy && (
          <p role="status">
            Preparing your data. This can take a few minutes; you can leave this
            page and come back.
          </p>
        )}
        {current?.status === "ready" && (
          <p>
            Your archive is ready
            {current.size_bytes != null &&
              ` (${formatFileSize(current.size_bytes, 1)})`}
            {current.expires_at != null &&
              `. It is deleted after ${day(current.expires_at)}`}
            .
          </p>
        )}
        {current?.status === "failed" && (
          <p role="alert" className="text-destructive">
            {current.error ?? "Preparing your data failed. Try again."}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {current?.status === "ready" && (
            <Button
              type="button"
              className="w-fit"
              disabled={download.isPending}
              onClick={() => download.mutate({})}
            >
              Download
            </Button>
          )}
          {!busy && (
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              disabled={prepare.isPending || state.isPending}
              onClick={() => prepare.mutate({})}
            >
              {current ? "Prepare a new archive" : "Prepare my data"}
            </Button>
          )}
        </div>
        {failure && (
          <p role="alert" className="text-destructive text-xs">
            {errorDetail(failure, "Couldn't reach your data archive.")}
          </p>
        )}
      </div>
    </SettingsSection>
  );
}
