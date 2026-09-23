"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  appCaptioningGetOptions,
  appCaptioningGetQueryKey,
  appCaptioningUpdateMutation,
  appCaptionModelCancelMutation,
  appCaptionModelDownloadMutation,
  appCaptionModelStatusQueryKey,
  appCaptionModelStatusOptions,
  appCaptioningProviderModelsGetOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { client } from "@/lib/api";

function CaptioningSettingsPane() {
  const queryClient = useQueryClient();
  const configuration = useQuery(appCaptioningGetOptions());
  const visionModelsQuery = useQuery(
    appCaptioningProviderModelsGetOptions({ client }),
  );
  const modelStatus = useQuery({
    ...appCaptionModelStatusOptions(),
    refetchInterval: (query) =>
      ["downloading", "verifying"].includes(query.state.data?.status ?? "")
        ? 1000
        : false,
  });
  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: appCaptioningGetQueryKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: appCaptionModelStatusQueryKey(),
    });
  };
  const update = useMutation({
    ...appCaptioningUpdateMutation(),
    onSuccess: invalidate,
  });
  const download = useMutation({
    ...appCaptionModelDownloadMutation(),
    onSuccess: invalidate,
  });
  const cancel = useMutation({
    ...appCaptionModelCancelMutation(),
    onSuccess: invalidate,
  });

  const visionModels = visionModelsQuery.data ?? [];
  const current = configuration.data;
  const [draftMode, setDraftMode] = useState<string>("disabled");
  useEffect(() => {
    if (current) setDraftMode(current.mode);
  }, [current]);
  const localStatus = modelStatus.data;
  const updateError = update.error;
  const updateErrorMessage =
    updateError instanceof Error
      ? updateError.message
      : typeof updateError === "object" &&
          updateError &&
          "detail" in updateError
        ? String(updateError.detail)
        : "The captioning configuration could not be saved.";

  if (configuration.isLoading) return <p>Loading image captioning settings…</p>;
  if (configuration.isError || !current) {
    return <p role="alert">Image captioning settings could not be loaded.</p>;
  }

  return (
    <section className="space-y-5" aria-labelledby="captioning-heading">
      <div>
        <h2 id="captioning-heading" className="text-lg font-semibold">
          Image captioning
        </h2>
        <p className="text-muted-foreground text-sm">
          Captions are draft metadata for image knowledge revisions. Provider
          mode sends images only to the selected vision model.
        </p>
      </div>
      <fieldset className="space-y-2" disabled={update.isPending}>
        <legend className="font-medium">Mode</legend>
        {[
          ["disabled", "Disabled"],
          ["provider", "Configured vision provider"],
          ["local", "Local SmolVLM2 (CPU)"],
        ].map(([mode, label]) => (
          <label className="flex items-center gap-2" key={mode}>
            <input
              type="radio"
              name="captioning-mode"
              checked={draftMode === mode}
              onChange={() => {
                setDraftMode(mode);
                if (mode !== "provider")
                  update.mutate({ body: { mode, provider_model_id: null } });
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {draftMode === "provider" && (
        <div className="space-y-2">
          <Label htmlFor="caption-provider-model">Vision model</Label>
          <select
            id="caption-provider-model"
            className="bg-background w-full rounded-md border p-2"
            value={current.provider_model_id ?? ""}
            onChange={(event) =>
              update.mutate({
                body: {
                  mode: "provider",
                  provider_model_id: event.target.value || null,
                },
              })
            }
          >
            <option value="">Select a discovered vision model</option>
            {visionModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.provider_name} — {model.name}
              </option>
            ))}
          </select>
          {visionModels.length === 0 && (
            <p role="alert" className="text-destructive text-sm">
              No active discovered vision-capable models are available.
            </p>
          )}
        </div>
      )}

      {draftMode === "local" && (
        <div className="space-y-2 rounded-md border p-4">
          <p className="text-sm">
            Model status: <strong>{localStatus?.status ?? "unknown"}</strong>
            {localStatus?.total_bytes
              ? ` (${localStatus.bytes_downloaded} / ${localStatus.total_bytes} bytes)`
              : ""}
          </p>
          {localStatus?.error && (
            <p role="alert" className="text-destructive text-sm">
              {localStatus.error}
            </p>
          )}
          {localStatus?.status === "downloading" ||
          localStatus?.status === "verifying" ? (
            <Button
              variant="outline"
              onClick={() => cancel.mutate({})}
              disabled={cancel.isPending}
            >
              Cancel download
            </Button>
          ) : localStatus?.status !== "ready" ? (
            <Button
              onClick={() => download.mutate({})}
              disabled={download.isPending}
            >
              Download model
            </Button>
          ) : (
            <p className="text-muted-foreground text-sm">
              The verified local model is ready. CPU inference is bounded to one
              concurrent caption by default.
            </p>
          )}
        </div>
      )}
      {update.isError && (
        <p role="alert" className="text-destructive text-sm">
          {updateErrorMessage}
        </p>
      )}
    </section>
  );
}

export function CaptioningSettings() {
  return <CaptioningSettingsPane />;
}
