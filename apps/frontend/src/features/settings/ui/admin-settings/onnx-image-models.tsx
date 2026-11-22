"use client";

import { QueryError } from "@/components/query-error";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { SettingsSection } from "@/features/settings/ui/settings-section";
import { client } from "@/lib/api";
import type { OnnxModel, OnnxOverview } from "@/lib/client";
import {
  onnxImageCancelDownloadMutation,
  onnxImageDownloadMutation,
  onnxImageOverviewOptions,
  onnxImageOverviewQueryKey,
  onnxImageRemoveMutation,
  onnxImageSelectMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "@/lib/utils";

const gb = (value: number) =>
  `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} GB`;

const busy = (model: OnnxModel) =>
  model.download.status === "downloading" ||
  model.download.status === "verifying";

/** The ONNX generator's catalog: CPU models in every build (US-94.4). */
export function OnnxImageModels() {
  const queryClient = useQueryClient();
  const overview = useQuery({
    ...onnxImageOverviewOptions({ client }),
    staleTime: 0,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.models.some(busy) ? 1500 : false,
  });
  const apply = (data: OnnxOverview) =>
    queryClient.setQueryData(onnxImageOverviewQueryKey({ client }), data);
  const select = useMutation({
    ...onnxImageSelectMutation({ client }),
    onSuccess: apply,
  });
  const download = useMutation({
    ...onnxImageDownloadMutation({ client }),
    onSuccess: apply,
  });
  const cancel = useMutation({
    ...onnxImageCancelDownloadMutation({ client }),
    onSuccess: apply,
  });
  const remove = useMutation({
    ...onnxImageRemoveMutation({ client }),
    onSuccess: apply,
  });
  const [license, setLicense] = useState<OnnxModel | null>(null);

  if (!overview.data)
    return (
      <SettingsSection title="ONNX models">
        {overview.isError ? (
          <QueryError
            error={overview.error}
            message="The ONNX model list could not be loaded."
            retry={() => overview.refetch()}
            isRetrying={overview.isFetching}
          />
        ) : (
          <Spinner />
        )}
      </SettingsSection>
    );

  const { memory_gb, models, recommended_id, settings } = overview.data;
  const failure =
    select.error ?? download.error ?? cancel.error ?? remove.error;
  const pending =
    select.isPending ||
    download.isPending ||
    cancel.isPending ||
    remove.isPending;
  const startDownload = (model: OnnxModel, accept = false) =>
    download.mutate({
      path: { model_id: model.id },
      body: { accept_license: accept },
    });

  return (
    <SettingsSection
      title="ONNX models"
      description="Small, fast models that run on this server's CPU, with no GPU. The first image after a start takes longer while the model loads."
    >
      <dl className="text-sm">
        <dt className="text-muted-foreground">Server memory</dt>
        <dd data-testid="server-memory">{gb(memory_gb)}</dd>
      </dl>
      {!recommended_id && (
        <p role="note" className="text-muted-foreground text-sm">
          No ONNX model fits this server&apos;s memory. Use a ComfyUI server
          instead, or add memory.
        </p>
      )}
      {failure && (
        <p role="alert" className="text-destructive text-sm">
          {errorMessage(failure, "The ONNX model could not be changed.")}
        </p>
      )}
      <ul aria-label="ONNX models" className="min-w-0 divide-y border-y">
        {models.map((model) => {
          const inUse = settings.model_id === model.id;
          const percent = model.download.total_bytes
            ? Math.min(
                100,
                (model.download.bytes_downloaded / model.download.total_bytes) *
                  100,
              )
            : 0;
          return (
            <li
              key={model.id}
              aria-label={model.name}
              className="flex min-w-0 flex-col gap-2 py-3"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{model.name}</span>
                {model.id === recommended_id && <Badge>Recommended</Badge>}
                {inUse && <Badge variant="secondary">In use</Badge>}
                {!model.commercial_use && (
                  <Badge variant="outline">License to accept</Badge>
                )}
              </div>
              <p className="text-muted-foreground text-sm text-pretty">
                {model.description}
              </p>
              <p className="text-sm">
                {gb(model.download_gb)} download · {gb(model.memory_gb)} memory
                ·{" "}
                <a
                  href={model.license_url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {model.license}
                </a>{" "}
                ·{" "}
                <span className={model.plan.fits ? "" : "text-destructive"}>
                  {model.plan.detail}
                </span>
              </p>
              {model.attribution && (
                <p
                  className="text-muted-foreground text-xs"
                  data-testid="attribution"
                >
                  {model.attribution}
                </p>
              )}
              {busy(model) && (
                <div className="flex flex-col gap-1">
                  <Progress
                    value={percent}
                    aria-label={`Downloading ${model.name}`}
                  />
                  <p className="text-muted-foreground text-xs">
                    {model.download.status === "verifying"
                      ? "Checking the files…"
                      : `${gb(model.download.bytes_downloaded / 1e9)} of ${gb(model.download.total_bytes / 1e9)}`}
                  </p>
                </div>
              )}
              {model.download.status === "failed" && (
                <p role="alert" className="text-destructive text-sm">
                  {model.download.error ?? "The download failed."}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {busy(model) ? (
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      cancel.mutate({ path: { model_id: model.id } })
                    }
                  >
                    Cancel download
                  </Button>
                ) : model.download.status === "ready" ? (
                  <>
                    {!inUse && (
                      <Button
                        disabled={pending || !model.plan.fits}
                        onClick={() =>
                          select.mutate({ body: { model_id: model.id } })
                        }
                      >
                        Use this model
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        remove.mutate({ path: { model_id: model.id } })
                      }
                    >
                      Remove files
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    disabled={pending || !model.plan.fits}
                    onClick={() =>
                      model.license_accepted
                        ? startDownload(model)
                        : setLicense(model)
                    }
                  >
                    {model.download.status === "failed"
                      ? "Retry download"
                      : "Download"}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <AlertDialog
        open={license !== null}
        onOpenChange={(open) => !open && setLicense(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Accept the license?</AlertDialogTitle>
            <AlertDialogDescription>
              {license?.name} is released under the {license?.license}, which
              limits how it may be used. Read it before you download.
              Downloading records that you accepted it for this installation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (license) startDownload(license, true);
                setLicense(null);
              }}
            >
              Accept and download
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
