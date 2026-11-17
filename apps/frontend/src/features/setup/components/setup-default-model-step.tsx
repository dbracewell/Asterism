"use client";

import { FormSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
} from "@/components/ui/select";
import { client } from "@/lib/api";
import {
  chatModelsListOptions,
  userSettingUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { actionClassName } from "./provider-setup-shared";

/**
 * The default model is a per-user setting, so a settings file cannot carry it,
 * and a new chat cannot send without one. The administrator picks it here.
 */
export function DefaultModelStep({
  onBack,
  onDone,
}: {
  onBack: () => void;
  onDone: () => void;
}) {
  const models = useQuery(chatModelsListOptions({ client }));
  const [modelId, setModelId] = useState("");
  const saveDefault = useMutation({
    ...userSettingUpdateMutation({ client }),
    onSuccess: onDone,
  });
  const available = models.data?.filter((model) => model.available) ?? [];

  if (models.isLoading) {
    return <FormSkeleton label="Loading imported models…" fields={1} />;
  }
  if (models.isError) {
    return (
      <QueryError
        error={models.error}
        message="Imported models could not be loaded."
        retry={() => models.refetch()}
        isRetrying={models.isRefetching}
      />
    );
  }
  if (available.length === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <p role="alert" className="text-sm">
          Settings imported, but the file has no active models. Set up a
          provider to continue.
        </p>
        <Button type="button" className={actionClassName} onClick={onBack}>
          Set up a provider
        </Button>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p role="status" className="text-sm">
        Settings imported. Choose the model new chats start with.
      </p>
      <Select value={modelId} onValueChange={setModelId}>
        <SelectTrigger aria-label="Default model">
          <SelectValue placeholder="Choose a model" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {available.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.display_name ?? model.name} ({model.provider_name})
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {saveDefault.isError && (
        <p role="alert" className="text-destructive text-sm">
          The default model could not be saved. Retry Continue.
        </p>
      )}
      <Button
        type="button"
        className={actionClassName}
        disabled={!modelId || saveDefault.isPending}
        onClick={() =>
          saveDefault.mutate({
            path: { key: "default_model_id" },
            body: { value: modelId },
          })
        }
      >
        Continue
      </Button>
    </div>
  );
}
