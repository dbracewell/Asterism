"use client";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { QueryError } from "@/components/query-error";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { client } from "@/lib/api";
import { ChatInfo, ChatModelChoice, MessageExecution } from "@/lib/client";
import {
  chatModelsListOptions,
  chatModelUpdateMutation,
  chatSessionGetOneOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

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
    <Field data-invalid={!!value && !!query.data && !selected?.available}>
      <FieldLabel htmlFor="chat-model">Chat model</FieldLabel>
      <Select
        value={value}
        onValueChange={onChange}
        disabled={disabled || !query.data}
      >
        <SelectTrigger
          id="chat-model"
          aria-label="Chat model"
          aria-invalid={!!value && !!query.data && !selected?.available}
        >
          <SelectValue placeholder="Choose a model" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {value && !selected && (
              <SelectItem value={value} disabled>
                {savedLabel ?? value} (unavailable)
              </SelectItem>
            )}
            {choices.map((choice) => (
              <SelectItem
                key={choice.id}
                value={choice.id}
                disabled={!choice.available}
              >
                {choice.name} ({choice.provider_name})
                {!choice.available ? " — unavailable" : ""}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {selected && <ModelCapabilities model={selected} />}
      {query.isPending && <p role="status">Loading models…</p>}
      {query.isError && (
        <p role="alert">
          {query.data
            ? "Could not refresh models. Showing cached choices."
            : "Could not load models."}{" "}
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </p>
      )}
      {query.data && !choices.some((choice) => choice.available) && (
        <p role="status">
          No available models. Ask an administrator to enable one.
        </p>
      )}
      {value && query.data && !selected?.available && (
        <p role="alert">
          Selected model is unavailable. Choose an available replacement.
        </p>
      )}
    </Field>
  );
}

export function ModelCapabilities({ model }: { model: ChatModelChoice }) {
  return (
    <div
      aria-label="Selected model capabilities"
      className="flex flex-wrap gap-2"
    >
      <Badge variant="secondary">
        {model.supports_vision === true
          ? "Images supported"
          : model.supports_vision === false
            ? "Text only"
            : "Image support unknown"}
      </Badge>
      <Badge variant="secondary">
        {model.supports_tools === true
          ? "Tools supported"
          : model.supports_tools === false
            ? "Tools unsupported"
            : "Tool support unknown"}
      </Badge>
      <Badge variant="secondary">
        {model.context_window
          ? `${model.context_window.toLocaleString()} token context`
          : "Context window unknown"}
      </Badge>
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
    <div className="flex flex-col gap-3">
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
        <div role="alert" className="flex flex-col items-start gap-2">
          <p>
            {mutation.error.detail ?? "Could not change model."} Reload the chat
            model before trying again.
          </p>
          <Button
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
      )}
    </div>
  );
}

export function ExecutionLabel({
  execution,
}: {
  execution?: MessageExecution | null;
}) {
  if (!execution) return null;
  return (
    <p className="text-muted-foreground text-xs" aria-label="Executed model">
      {execution.model.name} · {execution.model.provider_name} · configuration{" "}
      {execution.configuration.config_revision}
    </p>
  );
}
