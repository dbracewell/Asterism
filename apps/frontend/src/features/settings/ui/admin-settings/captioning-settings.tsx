"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { client } from "@/lib/api";
import {
  appCaptioningGetOptions,
  appCaptioningProviderModelsGetOptions,
  appCaptioningUpdateMutation,
  appCaptionModelCancelMutation,
  appCaptionModelDownloadMutation,
  appCaptionModelStatusOptions,
  appKnowledgeEmbeddingStatusOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

function CaptioningSettingsPane() {
  const configuration = useQuery(appCaptioningGetOptions({ client }));
  const visionModelsQuery = useQuery(
    appCaptioningProviderModelsGetOptions({ client }),
  );
  const modelStatus = useQuery({
    ...appCaptionModelStatusOptions({ client }),
    refetchInterval: (query) =>
      ["downloading", "verifying"].includes(query.state.data?.status ?? "")
        ? 1000
        : false,
  });
  const embeddingStatus = useQuery({
    ...appKnowledgeEmbeddingStatusOptions({ client }),
    refetchInterval: (query) =>
      ["downloading", "verifying"].includes(query.state.data?.status ?? "")
        ? 1000
        : false,
  });
  const update = useMutation(appCaptioningUpdateMutation({ client }));
  const download = useMutation(appCaptionModelDownloadMutation({ client }));
  const cancel = useMutation(appCaptionModelCancelMutation({ client }));

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

  if (configuration.isLoading) return <p>Loading knowledge processing settings…</p>;
  if (configuration.isError || !current) {
    return <p role="alert">Knowledge processing settings could not be loaded.</p>;
  }

  return (
    <section
      className="flex min-h-0 flex-1 flex-col space-y-5"
      aria-labelledby="knowledge-processing-heading"
    >
      <div>
        <h2 id="knowledge-processing-heading" className="text-lg font-semibold">
          Knowledge processing
        </h2>
        <p className="text-muted-foreground text-sm">
          Image captioning is one part of the platform-wide knowledge-processing
          policy. Changing its mode or provider creates replacement knowledge
          generations for eligible files; current ready generations remain
          searchable until each replacement succeeds.
        </p>
      </div>

      <div className="space-y-2 rounded-md border p-4">
        <h3 className="font-medium">Knowledge embeddings</h3>
        <p className="text-sm">
          Model status: <strong>{embeddingStatus.data?.status ?? "unknown"}</strong>
          {embeddingStatus.data?.total_bytes
            ? ` (${embeddingStatus.data.bytes_downloaded} / ${embeddingStatus.data.total_bytes} bytes)`
            : ""}
        </p>
        {embeddingStatus.data?.error ? (
          <p role="alert" className="text-destructive text-sm">
            {embeddingStatus.data.error}
          </p>
        ) : embeddingStatus.data?.status === "ready" ? (
          <p className="text-muted-foreground text-sm">
            The reviewed local embedding bundle is ready for file processing.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            Asterism provisions the reviewed local embedding bundle automatically.
            Files uploaded while it is preparing remain queued and are processed
            when the bundle is ready.
          </p>
        )}
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
                if (mode !== "provider") {
                  update.mutate({
                    body: {
                      mode: mode as "disabled" | "local",
                      provider_model_id: null,
                    },
                  });
                }
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {draftMode === "provider" && (
        <div className="space-y-2">
          <p className="rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
            Selecting a provider sends source images to that provider for caption
            generation. Save only if this external processing is appropriate for
            your files.
          </p>
          <Label htmlFor="caption-provider-model">Vision model</Label>
          <Select
            value={current.provider_model_id ?? ""}
            onValueChange={(value) => {
              update.mutate({
                body: {
                  mode: "provider",
                  provider_model_id: value,
                },
              });
            }}
          >
            <SelectTrigger
              id="caption-provider-model"
              className="w-full md:w-lg"
            >
              <SelectValue placeholder="Select a discovered vision model" />
            </SelectTrigger>
            <SelectContent>
              {visionModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.provider_name} — {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
