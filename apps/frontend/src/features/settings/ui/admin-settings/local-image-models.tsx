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
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { SettingsSection } from "@/features/settings/ui/settings-section";
import { client } from "@/lib/api";
import type { LocalModel, LocalOverview } from "@/lib/client";
import {
  localImageCancelDownloadMutation,
  localImageDownloadMutation,
  localImageOverviewOptions,
  localImageOverviewQueryKey,
  localImageRemoveMutation,
  localImageSelectMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

const DEVICE_LABELS: Record<string, string> = {
  auto: "Automatic",
  cuda: "NVIDIA GPU (CUDA)",
  mps: "Apple GPU (Metal)",
  cpu: "CPU",
};

const gb = (value: number) =>
  `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} GB`;

const busy = (model: LocalModel) =>
  model.download.status === "downloading" ||
  model.download.status === "verifying";

export function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "detail" in error)
    return String((error as { detail: unknown }).detail);
  return fallback;
}

/** Hardware, the model catalog and downloads for the local diffusers generator. */
export function LocalImageModels() {
  const queryClient = useQueryClient();
  const overview = useQuery({
    ...localImageOverviewOptions({ client }),
    staleTime: 0,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.models.some(busy) ? 1500 : false,
  });
  const apply = (data: LocalOverview) =>
    queryClient.setQueryData(localImageOverviewQueryKey({ client }), data);
  const select = useMutation({
    ...localImageSelectMutation({ client }),
    onSuccess: apply,
  });
  const download = useMutation({
    ...localImageDownloadMutation({ client }),
    onSuccess: apply,
  });
  const cancel = useMutation({
    ...localImageCancelDownloadMutation({ client }),
    onSuccess: apply,
  });
  const remove = useMutation({
    ...localImageRemoveMutation({ client }),
    onSuccess: apply,
  });
  const [license, setLicense] = useState<LocalModel | null>(null);

  if (!overview.data)
    return (
      <SettingsSection title="Local models">
        {overview.isError ? (
          <QueryError
            error={overview.error}
            message="The local model list could not be loaded."
            retry={() => overview.refetch()}
            isRetrying={overview.isFetching}
          />
        ) : (
          <Spinner />
        )}
      </SettingsSection>
    );

  const { hardware, models, recommended_id, settings } = overview.data;
  const failure =
    select.error ?? download.error ?? cancel.error ?? remove.error;
  const pending =
    select.isPending ||
    download.isPending ||
    cancel.isPending ||
    remove.isPending;
  const startDownload = (model: LocalModel, accept = false) =>
    download.mutate({
      path: { model_id: model.id },
      body: { accept_license: accept },
    });

  return (
    <SettingsSection
      title="Local models"
      description="Models run on this server in a separate worker process. Pick one that fits the hardware; the first image after a start takes longer while the model loads."
    >
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <dl className="text-sm">
          <dt className="text-muted-foreground">Detected hardware</dt>
          <dd data-testid="hardware">
            {hardware.name} · {gb(hardware.memory_gb)}
            {hardware.device === "cuda"
              ? " GPU memory"
              : hardware.device === "mps"
                ? " unified memory"
                : " memory"}
          </dd>
        </dl>
        <div className="flex flex-col gap-1">
          <Label htmlFor="local-image-device">Run on</Label>
          <Select
            value={settings.device ?? "auto"}
            disabled={pending}
            onValueChange={(device) =>
              select.mutate({
                body: {
                  model_id: settings.model_id ?? null,
                  device: device as "auto" | "cuda" | "mps" | "cpu",
                },
              })
            }
          >
            <SelectTrigger id="local-image-device" className="min-w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["auto", ...hardware.available].map((device) => (
                <SelectItem key={device} value={device}>
                  {DEVICE_LABELS[device] ?? device}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {!recommended_id && (
        <p role="note" className="text-muted-foreground text-sm">
          No catalog model fits this hardware. Use a ComfyUI server instead, or
          add memory.
        </p>
      )}
      {failure && (
        <p role="alert" className="text-destructive text-sm">
          {errorText(failure, "The local model could not be changed.")}
        </p>
      )}
      <ul aria-label="Local models" className="min-w-0 divide-y border-y">
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
                  <Badge variant="outline">Non-commercial</Badge>
                )}
              </div>
              <p className="text-muted-foreground text-sm text-pretty">
                {model.description}
              </p>
              <p className="text-sm">
                {gb(model.disk_gb)} download · {model.license} ·{" "}
                <span className={model.plan.fits ? "" : "text-destructive"}>
                  {model.plan.detail}
                </span>
              </p>
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
                          select.mutate({
                            body: {
                              model_id: model.id,
                              device: settings.device ?? "auto",
                            },
                          })
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
              {license?.name} is released under the {license?.license}. It may
              not be used commercially. Downloading records that you accepted it
              for this installation.
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
