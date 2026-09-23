"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { client } from "@/lib/api";
import { Llm, ProviderSettings, ProviderSummary } from "@/lib/client";
import {
  appProviderModelsDiscoverAndSyncMutation,
  appProviderModelsListOptions,
  appProviderModelUpdateMutation,
  appProviderSettingsGetOptions,
  appProviderSettingsGetQueryKey,
  appProviderSettingsUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { zProviderType } from "@/lib/client/zod.gen";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export const providerSchema = z
  .object({
    id: z.string(),
    name: z.string().trim().min(1, "Provider name is required."),
    base_url: z
      .string()
      .trim()
      .url("Base URL must be an absolute HTTP(S) URL."),
    api_key: z.string().trim().min(1, "API key is required."),
    provider_type: zProviderType,
  })
  .superRefine((provider, context) => {
    if (
      provider.provider_type === "openai" &&
      provider.base_url !== OPENAI_BASE_URL
    ) {
      context.addIssue({
        code: "custom",
        path: ["base_url"],
        message: "OpenAI uses Asterism's fixed API URL.",
      });
    }
  });
const formSchema = z.object({
  llm_providers: z.array(providerSchema),
  draft_model_id: z.string().nullable().optional(),
});
type Values = z.infer<typeof formSchema>;
type FormProvider = Values["llm_providers"][number];
const emptyProvider = (): FormProvider => ({
  id: self.crypto.randomUUID(),
  name: "",
  base_url: "",
  api_key: "",
  provider_type: "generic_openai",
});

function ModelRow({
  model,
  providerId,
  isDraft,
  onSetDraft,
}: {
  model: Llm;
  providerId: string;
  isDraft: boolean;
  onSetDraft: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [isActive, setIsActive] = useState(model.is_active);
  const [contextWindow, setContextWindow] = useState(
    model.context_window?.toString() ?? "",
  );
  const [vision, setVision] = useState(
    model.supports_vision == null ? "unknown" : String(model.supports_vision),
  );
  const update = useMutation({
    ...appProviderModelUpdateMutation({ client }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["appProviderModelsList"],
      });
      void queryClient.invalidateQueries({
        queryKey: appProviderSettingsGetQueryKey({ client }),
      });
      toast.success(`Saved ${model.name}`);
    },
    onError: () => toast.error(`Could not save ${model.name}.`),
  });
  useEffect(() => {
    setIsActive(model.is_active);
    setContextWindow(model.context_window?.toString() ?? "");
    setVision(
      model.supports_vision == null ? "unknown" : String(model.supports_vision),
    );
  }, [model]);
  const save = () => {
    const context = contextWindow.trim() ? Number(contextWindow) : null;
    if (context != null && (!Number.isInteger(context) || context < 1)) {
      toast.error("Context window must be a positive whole number.");
      return;
    }
    const supportsVision = vision === "unknown" ? null : vision === "true";
    update.mutate({
      path: { provider_id: providerId, model_id: model.id },
      body: {
        is_active: isActive,
        context_window: context,
        supports_vision: supportsVision,
        context_window_source:
          context == null
            ? "unknown"
            : ["catalog", "provider"].includes(
                  model.context_window_source ?? "",
                )
              ? model.context_window_source
              : "manual",
        vision_source:
          supportsVision == null
            ? "unknown"
            : ["catalog", "provider"].includes(model.vision_source ?? "")
              ? model.vision_source
              : "manual",
      },
    });
  };
  return (
    <div className="grid gap-3 rounded border p-3 lg:grid-cols-[minmax(14rem,1fr)_10rem_10rem_auto]">
      <div className="flex min-w-0 items-center gap-2">
        <Checkbox
          id={`model-${model.id}-active`}
          checked={isActive}
          onCheckedChange={(value) => setIsActive(value === true)}
        />
        <FieldLabel
          htmlFor={`model-${model.id}-active`}
          className="min-w-0 truncate"
          title={model.name}
        >
          {model.name}
        </FieldLabel>
      </div>
      <Field>
        <FieldLabel htmlFor={`model-${model.id}-context`}>
          Context window
        </FieldLabel>
        <Input
          id={`model-${model.id}-context`}
          type="number"
          min={1}
          value={contextWindow}
          onChange={(event) => setContextWindow(event.target.value)}
          placeholder="Unknown"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`model-${model.id}-vision`}>
          Vision input
        </FieldLabel>
        <Select value={vision} onValueChange={setVision}>
          <SelectTrigger id={`model-${model.id}-vision`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unknown">Unknown</SelectItem>
            <SelectItem value="true">Supported</SelectItem>
            <SelectItem value="false">Not supported</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="flex items-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={save}
          disabled={update.isPending}
        >
          {update.isPending ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <SaveIcon />
          )}
          Save
        </Button>
        <Button
          type="button"
          variant={isDraft ? "secondary" : "ghost"}
          onClick={() => onSetDraft(model.id)}
          disabled={!isActive || isDraft}
        >
          {isDraft ? "Draft model" : "Set draft"}
        </Button>
      </div>
    </div>
  );
}

function ModelCatalog({
  provider,
  draftModelId,
  onSetDraft,
  onRefresh,
}: {
  provider: ProviderSummary;
  draftModelId?: string | null;
  onSetDraft: (id: string) => void;
  onRefresh: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<Array<string | null>>(
    [],
  );
  const catalog = useQuery({
    ...appProviderModelsListOptions({
      client,
      path: { provider_id: provider.id },
      query: { query, cursor: cursor ?? undefined, limit: 50 },
    }),
    enabled: expanded,
  });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(searchInput.trim());
      setCursor(null);
      setPreviousCursors([]);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  const models = catalog.data?.models ?? [];
  return (
    <div className="bg-muted/20 mt-3 rounded border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronUpIcon />
          ) : (
            `Browse ${(provider.model_count ?? 0).toLocaleString()} models`
          )}
          {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onRefresh(provider.id)}
        >
          <RefreshCwIcon />
          Refresh catalog
        </Button>
        <span className="text-muted-foreground text-sm">
          {(provider.active_model_count ?? 0).toLocaleString()} active
        </span>
      </div>
      {expanded && (
        <div className="mt-3 space-y-3">
          <Input
            aria-label={`Search ${provider.name} models`}
            placeholder="Search models"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          {catalog.isLoading ? (
            <div className="flex justify-center p-4">
              <Spinner size={28} />
            </div>
          ) : catalog.isError ? (
            <p role="alert">Models could not be loaded.</p>
          ) : (
            <>
              <p className="text-muted-foreground text-sm">
                {(catalog.data?.total ?? 0).toLocaleString()} matching models ·
                50 per page
              </p>
              <div className="grid gap-2">
                {models.map((model) => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    providerId={provider.id}
                    isDraft={draftModelId === model.id}
                    onSetDraft={onSetDraft}
                  />
                ))}
              </div>
              {models.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  No matching models.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={previousCursors.length === 0}
                  onClick={() => {
                    const previous = previousCursors.at(-1) ?? null;
                    setPreviousCursors((items) => items.slice(0, -1));
                    setCursor(previous);
                  }}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!catalog.data?.next_cursor}
                  onClick={() => {
                    setPreviousCursors((items) => [...items, cursor]);
                    setCursor(catalog.data?.next_cursor ?? null);
                  }}
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ProvidersForm({ appSettings }: { appSettings: ProviderSettings }) {
  const queryClient = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      llm_providers: appSettings.llm_providers ?? [],
      draft_model_id: appSettings.draft_model_id ?? null,
    },
    mode: "onBlur",
  });
  const {
    control,
    formState,
    getValues,
    handleSubmit,
    register,
    reset,
    trigger,
  } = form;
  const { fields, append, remove } = useFieldArray({
    control,
    name: "llm_providers",
    keyName: "fieldKey",
  });
  const saveProviders = useMutation({
    ...appProviderSettingsUpdateMutation({ client }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: appProviderSettingsGetQueryKey({ client }),
      }),
  });
  const refreshCatalog = useMutation({
    ...appProviderModelsDiscoverAndSyncMutation({ client }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: appProviderSettingsGetQueryKey({ client }),
      });
      void queryClient.invalidateQueries({
        queryKey: ["appProviderModelsList"],
      });
      toast.success("Model catalog refreshed.");
    },
    onError: () =>
      toast.error(
        "Model discovery failed. Check the provider connection and try again.",
      ),
  });
  useEffect(() => {
    reset({
      llm_providers: appSettings.llm_providers ?? [],
      draft_model_id: appSettings.draft_model_id ?? null,
    });
  }, [appSettings, reset]);
  const save = async (values: Values, message?: string) => {
    try {
      await saveProviders.mutateAsync({ body: values });
      if (message) toast.success(message);
    } catch {
      toast.error("Failed to save provider settings.");
      throw new Error("Provider settings save failed");
    }
  };
  const refresh = async (providerId: string) => {
    if (!(await trigger())) return;
    try {
      await save(getValues());
      await refreshCatalog.mutateAsync({ path: { provider_id: providerId } });
    } catch {
      /* mutations report errors */
    }
  };
  const setDraft = async (modelId: string) => {
    try {
      await save(
        { ...getValues(), draft_model_id: modelId },
        "Draft model updated.",
      );
    } catch {
      /* save reports errors */
    }
  };
  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden"
      onSubmit={handleSubmit((values) => void save(values, "Settings saved."))}
    >
      <div className="relative">
        <h1 className="border-b pb-2 text-base font-bold">
          OpenAI API Compatible Providers
        </h1>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => append(emptyProvider())}
          aria-label="Add provider"
          className="absolute top-0 right-0"
        >
          <PlusIcon />
        </Button>
      </div>
      {appSettings.draft_model ? (
        <p className="text-muted-foreground text-sm">
          Draft model: {appSettings.draft_model.provider_name} —{" "}
          {appSettings.draft_model.name}
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">
          Choose an active model below to use as the draft model.
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {fields.map((field, index) => {
          const errors = formState.errors.llm_providers?.[index];
          const provider = appSettings.llm_providers?.find(
            (item) => item.id === field.id,
          ) ?? { ...field, model_count: 0, active_model_count: 0 };
          return (
            <FieldSet
              key={field.fieldKey}
              className="bg-background/30 rounded border p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <FieldTitle className="text-base! font-medium!">
                  {field.name.trim() || `Provider ${index + 1}`}
                </FieldTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(index)}
                  aria-label={`Delete provider ${index + 1}`}
                >
                  <Trash2Icon />
                </Button>
              </div>
              <FieldGroup>
                <Input
                  type="hidden"
                  {...register(`llm_providers.${index}.id`)}
                />
                <Field>
                  <FieldLabel htmlFor={`provider-type-${index}`}>
                    Provider Type
                  </FieldLabel>
                  <FieldContent>
                    <Select
                      value={form.getValues(
                        `llm_providers.${index}.provider_type`,
                      )}
                      onValueChange={(value) => {
                        form.setValue(
                          `llm_providers.${index}.provider_type`,
                          value as FormProvider["provider_type"],
                          { shouldDirty: true, shouldValidate: true },
                        );
                        form.setValue(
                          `llm_providers.${index}.base_url`,
                          value === "openai" ? OPENAI_BASE_URL : "",
                          { shouldDirty: true, shouldValidate: true },
                        );
                      }}
                    >
                      <SelectTrigger
                        id={`provider-type-${index}`}
                        aria-label={`Provider type for provider ${index + 1}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="generic_openai">
                          Generic OpenAI
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`provider-name-${index}`}>
                    Provider Name
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      id={`provider-name-${index}`}
                      {...register(`llm_providers.${index}.name`)}
                    />
                    <FieldError errors={[errors?.name]} />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`provider-base-url-${index}`}>
                    Base URL
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      id={`provider-base-url-${index}`}
                      placeholder="https://api.example.com/v1"
                      {...register(`llm_providers.${index}.base_url`)}
                    />
                    <FieldError errors={[errors?.base_url]} />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`provider-api-key-${index}`}>
                    API Key
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      id={`provider-api-key-${index}`}
                      type="password"
                      {...register(`llm_providers.${index}.api_key`)}
                    />
                    <FieldError errors={[errors?.api_key]} />
                  </FieldContent>
                </Field>
              </FieldGroup>
              <ModelCatalog
                provider={provider}
                draftModelId={appSettings.draft_model_id}
                onSetDraft={setDraft}
                onRefresh={refresh}
              />
            </FieldSet>
          );
        })}
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={saveProviders.isPending}>
          {saveProviders.isPending ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <SaveIcon />
          )}
          Save
        </Button>
      </div>
    </form>
  );
}

export function ProvidersTab({
  appSettings,
}: {
  appSettings?: ProviderSettings;
}) {
  const providerSettings = useQuery({
    ...appProviderSettingsGetOptions({ client }),
    enabled: appSettings === undefined,
  });
  const settings = appSettings ?? providerSettings.data;
  if (appSettings === undefined && providerSettings.isLoading)
    return <Spinner />;
  if (providerSettings.isError || settings == null)
    return <p role="alert">Provider settings could not be loaded.</p>;
  return <ProvidersForm appSettings={settings} />;
}
