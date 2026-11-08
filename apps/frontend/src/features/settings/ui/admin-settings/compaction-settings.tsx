"use client";

import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useUser } from "@/features/auth/components/user-context";
import {
  SettingsPane,
  SettingsSaveBar,
  SettingsSection,
} from "@/features/settings/ui/settings-section";
import { client } from "@/lib/api";
import type { CompactionSettings } from "@/lib/client";
import {
  appCompactionGetOptions,
  appCompactionGetQueryKey,
  appCompactionUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

const CHAT_MODEL = "chat-model";

/** Text field values; validated before saving. */
type Draft = {
  threshold: string;
  tailTurns: string;
  fallbackWindow: string;
  modelId: string;
};

const toDraft = (settings: CompactionSettings): Draft => ({
  threshold: String(Math.round((settings.threshold ?? 0.8) * 100)),
  tailTurns: String(settings.tail_turns ?? 3),
  fallbackWindow: String(settings.fallback_context_window ?? 32768),
  modelId: settings.model_id ?? CHAT_MODEL,
});

const wholeNumber = (value: string) =>
  /^\d+$/.test(value.trim()) ? Number(value) : NaN;

/** The settings a draft describes, or the first problem with it. */
export const parseCompactionDraft = (
  draft: Draft,
): { settings: CompactionSettings } | { error: string } => {
  const threshold = wholeNumber(draft.threshold);
  if (!(threshold >= 50 && threshold <= 95))
    return { error: "Compact at must be between 50% and 95%." };
  const tail = wholeNumber(draft.tailTurns);
  if (!(tail >= 1 && tail <= 20))
    return { error: "Recent turns kept must be between 1 and 20." };
  const fallback = wholeNumber(draft.fallbackWindow);
  if (!(fallback >= 2048 && fallback <= 10_000_000))
    return {
      error: "Fallback context window must be between 2,048 and 10,000,000.",
    };
  return {
    settings: {
      threshold: threshold / 100,
      tail_turns: tail,
      fallback_context_window: fallback,
      model_id: draft.modelId === CHAT_MODEL ? null : draft.modelId,
    },
  };
};

export function CompactionSettingsPane() {
  const user = useUser();
  return user.role === "admin" ? (
    <CompactionForm key={user.id} />
  ) : (
    <p role="alert">
      Administrator access is required to manage context compaction.
    </p>
  );
}

function CompactionForm() {
  const queryClient = useQueryClient();
  const policy = useQuery({
    ...appCompactionGetOptions({ client }),
    staleTime: 0,
    retry: false,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  const update = useMutation({
    ...appCompactionUpdateMutation({ client }),
    onSuccess(data) {
      queryClient.setQueryData(appCompactionGetQueryKey({ client }), data);
      setDraft(null);
      setSaved(true);
    },
  });
  if (!policy.data)
    return policy.isError ? (
      <QueryError
        error={policy.error}
        message="Context compaction settings could not be loaded."
        retry={() => policy.refetch()}
        isRetrying={policy.isFetching}
      />
    ) : (
      <Spinner />
    );

  const stored = toDraft(policy.data.settings);
  const current = draft ?? stored;
  const dirty = JSON.stringify(current) !== JSON.stringify(stored);
  const parsed = parseCompactionDraft(current);
  const change = (patch: Partial<Draft>) => {
    setDraft({ ...current, ...patch });
    setSaved(false);
    update.reset();
  };
  const error = update.error;
  const errorText =
    error && "detail" in error
      ? String(error.detail)
      : "Context compaction settings could not be saved. Retry when administrator access is available.";
  const models = policy.data.models ?? [];
  // A saved model that is no longer active stays visible until replaced.
  const missingModel =
    current.modelId !== CHAT_MODEL &&
    !models.some((model) => model.id === current.modelId);

  return (
    <SettingsPane
      title="Context compaction"
      description="When a chat nears its model's context window, earlier turns are summarized so the chat keeps working. Messages are never deleted; users can also compact a chat themselves."
    >
      <SettingsSection
        title="When to compact"
        description="Compaction runs before a turn whose estimated request is over the threshold."
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="compaction-threshold">
              Compact at (% of the context window)
            </FieldLabel>
            <Input
              id="compaction-threshold"
              inputMode="numeric"
              value={current.threshold}
              onChange={(event) => change({ threshold: event.target.value })}
            />
            <FieldDescription>
              Between 50 and 95. Estimates are approximate, so leave headroom.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="compaction-tail">
              Recent turns kept in full
            </FieldLabel>
            <Input
              id="compaction-tail"
              inputMode="numeric"
              value={current.tailTurns}
              onChange={(event) => change({ tailTurns: event.target.value })}
            />
            <FieldDescription>
              The latest user turns, with their replies, are always sent word
              for word. If that is still too large, only the current turn is
              kept.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="compaction-fallback">
              Fallback context window (tokens)
            </FieldLabel>
            <Input
              id="compaction-fallback"
              inputMode="numeric"
              value={current.fallbackWindow}
              onChange={(event) =>
                change({ fallbackWindow: event.target.value })
              }
            />
            <FieldDescription>
              Used for models whose context window is unknown. Set the real
              window on the model in Providers when you know it.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </SettingsSection>
      <SettingsSection
        title="Summarizer"
        description="The model that writes summaries. Its summary is treated as untrusted text and grants nothing."
      >
        <Field>
          <FieldLabel htmlFor="compaction-model">Compaction model</FieldLabel>
          <Select
            value={current.modelId}
            onValueChange={(modelId) => change({ modelId })}
          >
            <SelectTrigger id="compaction-model" className="w-full max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CHAT_MODEL}>
                Each chat&apos;s own model
              </SelectItem>
              {missingModel && (
                <SelectItem value={current.modelId}>
                  Unavailable model
                </SelectItem>
              )}
              {models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.display_name || model.name} ({model.provider_name})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            A dedicated model must be usable by the chat&apos;s owner; if it is
            not, compaction fails rather than switching models.
          </FieldDescription>
        </Field>
      </SettingsSection>
      {"error" in parsed && dirty && (
        <p role="alert" className="text-destructive text-sm">
          {parsed.error}
        </p>
      )}
      {update.isError && (
        <p role="alert" className="text-destructive text-sm">
          {errorText}
        </p>
      )}
      <SettingsSaveBar
        dirty={dirty}
        status={saved ? "Context compaction settings saved." : undefined}
      >
        <Button
          disabled={
            !dirty || "error" in parsed || update.isPending || policy.isFetching
          }
          onClick={() => {
            if ("settings" in parsed) update.mutate({ body: parsed.settings });
          }}
        >
          {update.isPending ? "Saving…" : "Save compaction settings"}
        </Button>
      </SettingsSaveBar>
    </SettingsPane>
  );
}
