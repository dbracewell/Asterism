"use client";

import { QueryError } from "@/components/query-error";
import {
  capabilityLabels,
  supportedCapabilities,
} from "@/components/settings/model-identity";
import { ModelSelector } from "@/components/settings/model-selector";
import {
  isPlanErrorCode,
  PlanRecoveryNotice,
  PlanUsageIndicator,
} from "@/features/chatgpt/components/plan-usage";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { client } from "@/lib/api";
import { ChatInfo, ChatModelChoice, MessageExecution } from "@/lib/client";
import {
  chatModelsListOptions,
  chatModelUpdateMutation,
  chatSessionGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

const NOTICE_CLASS = "order-last w-full basis-full px-2 text-xs";

/**
 * Composer-toolbar model selector. Renders as a fragment so the selector sits
 * inline while status notices wrap onto their own row of a flex-wrap parent.
 */
export function ChatModelPicker({
  value,
  onChange,
  disabled = false,
  savedLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  savedLabel?: string;
}) {
  const query = useQuery({
    ...chatModelsListOptions({ client }),
    staleTime: 0,
    retry: false,
  });
  const choices = query.data ?? [];
  const selected = choices.find((choice) => choice.id === value);
  return (
    <>
      <ModelSelector
        id="chat-model"
        variant="inline"
        aria-label="Chat model"
        aria-invalid={!!value && !!query.data && !selected?.available}
        showProvider
        showCapabilities
        value={value}
        onValueChange={onChange}
        availableModels={choices}
        savedLabel={savedLabel}
        disabled={disabled || !query.data}
      />
      {selected && <ModelCapabilities model={selected} />}
      {selected?.provider_type === "chatgpt" && selected.available && (
        <PlanUsageIndicator />
      )}
      {query.isPending && (
        <p role="status" className="sr-only">
          Loading models…
        </p>
      )}
      {query.isError && (
        <p
          role="alert"
          className={cn(NOTICE_CLASS, "text-destructive flex items-center")}
        >
          {query.data
            ? "Could not refresh models. Showing cached choices."
            : "Could not load models."}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </p>
      )}
      {query.data && !choices.some((choice) => choice.available) && (
        <p role="status" className={cn(NOTICE_CLASS, "text-muted-foreground")}>
          No available models. Ask an administrator to enable one.
        </p>
      )}
      {value &&
        query.data &&
        !selected?.available &&
        (isPlanErrorCode(selected?.unavailable_code) ? (
          <PlanRecoveryNotice
            code={selected.unavailable_code}
            message={selected.unavailable_reason ?? ""}
            className={NOTICE_CLASS}
          />
        ) : (
          <p role="alert" className={cn(NOTICE_CLASS, "text-destructive")}>
            Selected model is unavailable. Choose an available replacement.
          </p>
        ))}
    </>
  );
}

export function ModelCapabilities({ model }: { model: ChatModelChoice }) {
  const labels = capabilityLabels(model);
  return (
    <div
      aria-label="Selected model capabilities"
      title={labels.join(" · ")}
      className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs"
    >
      {supportedCapabilities(model).map(({ key, icon: Icon, name }) => (
        <Hint key={key} hint={name}>
          <Icon aria-hidden="true" className="size-5" />
        </Hint>
      ))}
      <span className="sr-only">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </span>
    </div>
  );
}

export function ExistingChatModelPicker({
  info,
  disabled,
  onSelected,
  onPendingChange,
}: {
  info: ChatInfo;
  disabled: boolean;
  onSelected: (info: ChatInfo) => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const current = useQuery({
    ...chatSessionGetOneOptions({ client, path: { chat_id: info.id } }),
    enabled: false,
    retry: false,
  });
  const mutation = useMutation({
    ...chatModelUpdateMutation({ client }),
    onMutate: () => onPendingChange?.(true),
    onSuccess: onSelected,
    onSettled: () => onPendingChange?.(false),
    onError: () =>
      toast.error(
        "Could not change model. Reload the chat and retry when generation is idle.",
      ),
  });
  return (
    <>
      <ChatModelPicker
        value={info.selected_model_id ?? ""}
        savedLabel={
          info.selected_model
            ? `${info.selected_model.name} (${info.selected_model.provider_name})`
            : undefined
        }
        disabled={
          disabled ||
          mutation.isPending ||
          !!mutation.error ||
          current.isFetching
        }
        onChange={(model_id) =>
          mutation.mutate({
            path: { chat_id: info.id },
            body: {
              model_id,
              expected_model_revision: info.model_revision ?? 1,
            },
          })
        }
      />
      {mutation.error && (
        <div
          role="alert"
          className={cn(NOTICE_CLASS, "text-destructive flex items-center")}
        >
          <p>
            {mutation.error.detail ?? "Could not change model."} Reload the chat
            model before trying again.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || current.isFetching}
            onClick={async () => {
              const result = await current.refetch();
              if (result.data && !result.isError) {
                onSelected(result.data.info);
                mutation.reset();
              }
            }}
          >
            Reload chat model
          </Button>
        </div>
      )}
      {mutation.error && current.error && (
        <div className={NOTICE_CLASS}>
          <QueryError
            error={current.error}
            message="Could not reload the chat model."
            retry={async () => {
              const result = await current.refetch();
              if (result.data && !result.isError) {
                onSelected(result.data.info);
                mutation.reset();
              }
            }}
            isRetrying={current.isFetching}
          />
        </div>
      )}
    </>
  );
}

export function ExecutionLabel({
  execution,
}: {
  execution?: MessageExecution | null;
}) {
  if (!execution) return null;
  return (
    <>
      <p className="text-muted-foreground text-xs" aria-label="Executed model">
        {execution.model.name} · {execution.model.provider_name} · configuration{" "}
        {execution.configuration.config_revision}
      </p>
      <p
        className="text-muted-foreground text-xs wrap-anywhere"
        aria-label="Executed persona"
      >
        {execution.persona.name} · persona revision {execution.persona.revision}
      </p>
    </>
  );
}
