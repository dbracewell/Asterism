"use client";

import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useReadWriteSearchParams } from "@/hooks/use-read-write-search-params";
import { client } from "@/lib/api";
import { Llm, ProviderSettings, ProviderSummary } from "@/lib/client";
import {
  appProviderModelsDiscoverAndSyncMutation,
  appProviderModelsListOptions,
  appProviderModelUpdateMutation,
  appProviderSettingsGetOptions,
  appProviderSettingsUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { zProviderType } from "@/lib/client/zod.gen";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ComputerIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export const providerSchema = z
  .object({
    id: z.string(),
    name: z.string().trim().min(1, "Provider name is required."),
    base_url: z.url("Base URL must be an absolute HTTP(S) URL."),
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

type ModelDraft = { model: Llm; contextWindow: string };
type ModelDrafts = Record<string, ModelDraft>;
const modelDraft = (model: Llm): ModelDraft => ({
  model,
  contextWindow: model.context_window?.toString() ?? "",
});

function ModelRow({
  draft,
  isDraft,
  onChange,
  onSetDraft,
}: {
  draft: ModelDraft;
  isDraft: boolean;
  onChange: (draft: ModelDraft) => void;
  onSetDraft: (id: string) => void;
}) {
  const { model, contextWindow } = draft;
  const isActive = model.is_active;
  const vision =
    model.supports_vision == null ? "unknown" : String(model.supports_vision);
  const toolSupport =
    model.supports_tools == null ? "unknown" : String(model.supports_tools);
  const changeModel = (changes: Partial<Llm>) =>
    onChange({ ...draft, model: { ...model, ...changes } });

  return (
    <FieldGroup className="rounded-surface grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3 border p-3">
      <div className="flex min-w-0 items-center gap-2">
        <Checkbox
          id={`model-${model.id}-active`}
          checked={isActive}
          onCheckedChange={(value) =>
            changeModel({ is_active: value === true })
          }
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
          onChange={(event) =>
            onChange({
              ...draft,
              contextWindow: event.target.value,
              model: {
                ...model,
                context_window_source: event.target.value.trim()
                  ? "manual"
                  : "unknown",
              },
            })
          }
          placeholder="Unknown"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`model-${model.id}-vision`}>
          Vision input
        </FieldLabel>
        <Select
          value={vision}
          onValueChange={(value) =>
            changeModel({
              supports_vision: value === "unknown" ? null : value === "true",
              vision_source: value === "unknown" ? "unknown" : "manual",
            })
          }
        >
          <SelectTrigger id={`model-${model.id}-vision`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="unknown">Unknown</SelectItem>
              <SelectItem value="true">Supported</SelectItem>
              <SelectItem value="false">Not supported</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor={`model-${model.id}-tools`}>Tool calls</FieldLabel>
        <Select
          value={toolSupport}
          onValueChange={(value) =>
            changeModel({
              supports_tools: value === "unknown" ? null : value === "true",
              tools_source: value === "unknown" ? "unknown" : "manual",
            })
          }
        >
          <SelectTrigger id={`model-${model.id}-tools`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="unknown">Unknown</SelectItem>
              <SelectItem value="true">Supported</SelectItem>
              <SelectItem value="false">Not supported</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <div className="flex flex-wrap items-end gap-2">
        <Button
          type="button"
          variant={isDraft ? "secondary" : "ghost"}
          onClick={() => {
            onChange(draft);
            onSetDraft(model.id);
          }}
          disabled={!isActive || isDraft}
        >
          {isDraft ? "Draft model" : "Set draft"}
        </Button>
      </div>
    </FieldGroup>
  );
}

function ModelCatalog({
  provider,
  draftModelId,
  onSetDraft,
  onRefresh,
  drafts,
  onChange,
}: {
  provider: ProviderSummary;
  draftModelId?: string | null;
  onSetDraft: (id: string) => void;
  onRefresh: (id: string) => void;
  drafts: ModelDrafts;
  onChange: (draft: ModelDraft) => void;
}) {
  const { getSearchParam, setSearchParams } = useReadWriteSearchParams();
  const searchProviderId = getSearchParam("provider");
  const [expanded, setExpanded] = useState(
    provider.id === searchProviderId ||
      getSearchParam("provider") === provider.id,
  );
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(getSearchParam("cursor"));
  const [previousCursors, setPreviousCursors] = useState<Array<string | null>>(
    [],
  );

  useEffect(() => {
    if (provider.id === searchProviderId) {
      setExpanded(true);
    }
    if (getSearchParam("provider") === provider.id) {
      setExpanded(true);
    }
  }, [provider.id, searchProviderId, getSearchParam]);

  const catalog = useQuery({
    ...appProviderModelsListOptions({
      client,
      path: { provider_id: provider.id },
      query: { query, cursor: cursor ?? undefined, limit: 50 },
    }),
    enabled: expanded,
  });

  const models = catalog.data?.models ?? [];

  const isFirstSearchRender = useRef(true);
  useEffect(() => {
    if (isFirstSearchRender.current) {
      // The mount-time run only resets state to its initial values, and firing
      // it late would wipe pagination the user already navigated to.
      isFirstSearchRender.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      setQuery(searchInput.trim());
      setCursor(null);
      setPreviousCursors([]);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const setAllModelsActive = (isActive: boolean) => {
    for (const model of models) {
      const draft = drafts[model.id] ?? modelDraft(model);
      onChange({ ...draft, model: { ...draft.model, is_active: isActive } });
    }
  };

  return (
    <div className="bg-muted/20 rounded-surface mt-3 border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setExpanded(!expanded);
            if (!expanded) setSearchParams({ provider: provider.id });
          }}
        >
          {expanded
            ? `Hide models`
            : `Browse ${(provider.model_count ?? 0).toLocaleString()} models`}
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
      <div className="text-muted-foreground mt-2 flex items-center gap-2 text-sm">
        <Button
          type="button"
          variant="ghost"
          onClick={() => void setAllModelsActive(true)}
          disabled={models.length === 0}
          title="Select all models displayed on this page"
        >
          Select All
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void setAllModelsActive(false)}
          disabled={models.length === 0}
          title="Unselect all models displayed on this page"
        >
          Unselect All
        </Button>
      </div>
      {expanded && (
        <div className="mt-3 flex min-w-0 flex-col gap-3">
          <InputGroup>
            <InputGroupInput
              aria-label={`Search ${provider.name} models`}
              placeholder="Search models"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            {searchInput && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  aria-label={`Clear ${provider.name} model search`}
                  size="icon-xs"
                  onClick={() => setSearchInput("")}
                >
                  <XIcon />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
          {catalog.isLoading ? (
            <ListSkeleton label="Loading models…" rows={5} />
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
                    draft={drafts[model.id] ?? modelDraft(model)}
                    onChange={onChange}
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
  const router = useRouter();
  const [drafts, setDrafts] = useState<ModelDrafts>({});
  const [isSaving, setIsSaving] = useState(false);
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
    setValue,
    trigger,
  } = form;

  const { fields, append, remove } = useFieldArray({
    control,
    name: "llm_providers",
    keyName: "fieldKey",
  });

  const saveProviders = useMutation({
    ...appProviderSettingsUpdateMutation({ client }),
  });

  const refreshCatalog = useMutation({
    ...appProviderModelsDiscoverAndSyncMutation({ client }),
    onSuccess: () => {
      router.refresh();
      toast.success("Model catalog refreshed.");
    },
    onError: () =>
      toast.error(
        "Model discovery failed. Check the provider connection and try again.",
      ),
  });

  const updateModel = useMutation(appProviderModelUpdateMutation({ client }));
  const draftModelId = useWatch({ control, name: "draft_model_id" });
  const hasChanges =
    Object.keys(formState.dirtyFields).length > 0 ||
    Object.keys(drafts).length > 0;

  useEffect(() => {
    reset(
      {
        llm_providers: appSettings.llm_providers ?? [],
        draft_model_id: appSettings.draft_model_id ?? null,
      },
      { keepDirtyValues: true },
    );
  }, [appSettings, reset]);

  const save = async (values: Values, message?: string) => {
    const pending = Object.values(drafts).filter(({ model }) =>
      values.llm_providers.some(
        (provider) => provider.id === model.provider_id,
      ),
    );
    const updates = pending.map(({ model, contextWindow }) => ({
      model,
      context: contextWindow.trim() ? Number(contextWindow) : null,
    }));
    if (
      updates.some(
        ({ context }) =>
          context != null && (!Number.isSafeInteger(context) || context < 1),
      )
    ) {
      toast.error("Context window must be a positive whole number.");
      throw new Error("Invalid context window");
    }
    setIsSaving(true);
    try {
      // Save models first so a newly enabled model can be selected as the draft.
      for (const { model, context } of updates) {
        await updateModel.mutateAsync({
          path: { provider_id: model.provider_id, model_id: model.id },
          body: {
            is_active: model.is_active,
            context_window: context,
            supports_vision: model.supports_vision,
            supports_tools: model.supports_tools,
            tools_source: model.tools_source,
            context_window_source: model.context_window_source,
            vision_source: model.vision_source,
          },
        });
      }
      await saveProviders.mutateAsync({ body: values });
      setDrafts({});
      reset(values);
      router.refresh();
      if (message) toast.success(message);
    } catch {
      toast.error(
        "Could not save all settings. Your edits are kept; retry Save.",
      );
      throw new Error("Provider settings save failed");
    } finally {
      setIsSaving(false);
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

  const changeDraft = (draft: ModelDraft) => {
    setDrafts((current) => ({ ...current, [draft.model.id]: draft }));
    if (
      !draft.model.is_active &&
      draft.model.id === getValues("draft_model_id")
    ) {
      setValue("draft_model_id", null, { shouldDirty: true });
    }
  };

  const setDraft = (modelId: string) => {
    setValue("draft_model_id", modelId, { shouldDirty: true });
  };

  const deleteProvider = (index: number) => {
    const providerId = getValues(`llm_providers.${index}.id`);
    if (
      appSettings.draft_model?.provider_id === providerId ||
      Object.values(drafts).some(
        ({ model }) =>
          model.provider_id === providerId &&
          model.id === getValues("draft_model_id"),
      )
    ) {
      setValue("draft_model_id", null, { shouldDirty: true });
    }
    remove(index);
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden"
      onSubmit={handleSubmit((values) => {
        void save(values, "Settings saved.").catch(() => undefined);
      })}
    >
      <fieldset disabled={isSaving} className="contents">
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
        <p className="text-muted-foreground text-sm" role="status">
          {hasChanges
            ? "Unsaved changes. Click Save to apply all provider and model edits."
            : "Provider and model edits apply when you click Save."}
        </p>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto">
          {fields.length === 0 ? (
            <div className="text-muted-foreground bg-card rounded-surface m-3 flex flex-1 flex-col items-center justify-center gap-3 border border-dashed p-4 text-sm">
              <ComputerIcon className="text-muted-foreground/50 size-10" />
              <h4 className="max-w-sm text-center text-xl">
                No providers configured yet. Add one to get started.
              </h4>
              <Button type="button" onClick={() => append(emptyProvider())}>
                <PlusIcon /> Add Provider
              </Button>
            </div>
          ) : null}
          {fields.map((field, index) => {
            const errors = formState.errors.llm_providers?.[index];
            const provider = appSettings.llm_providers?.find(
              (item) => item.id === field.id,
            ) ?? { ...field, model_count: 0, active_model_count: 0 };
            return (
              <FieldSet
                key={field.fieldKey}
                className="bg-background/30 rounded-surface min-w-0 border p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <FieldTitle className="text-base! font-medium!">
                    {field.name.trim() || `Provider ${index + 1}`}
                  </FieldTitle>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => deleteProvider(index)}
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
                        data-1p-ignore
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
                        data-1p-ignore
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
                        data-1p-ignore
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
                  draftModelId={draftModelId}
                  onSetDraft={setDraft}
                  onRefresh={refresh}
                  drafts={drafts}
                  onChange={changeDraft}
                />
              </FieldSet>
            );
          })}
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <SaveIcon />
            )}
            Save
          </Button>
        </div>
      </fieldset>
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

  if (appSettings === undefined && providerSettings.isLoading) {
    return <ListSkeleton label="Loading provider settings…" detail />;
  }

  if (providerSettings.isError || settings == null) {
    return (
      <QueryError
        error={providerSettings.error}
        message="Provider settings could not be loaded."
        retry={() => providerSettings.refetch()}
        isRetrying={providerSettings.isRefetching}
      />
    );
  }

  return <ProvidersForm appSettings={settings} />;
}
