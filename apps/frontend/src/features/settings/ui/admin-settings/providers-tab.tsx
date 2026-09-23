"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ComputerIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { HelpIcon } from "@/components/help-icon";
import { ModelSelector } from "@/components/settings/model-selector";
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
import { LlmDisplayInfo, ProviderSettings } from "@/lib/client";
import {
  appProviderModelsDiscoverMutation,
  appProviderSettingsGetOptions,
  appProviderSettingsGetQueryKey,
  appProviderSettingsUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import {
  zLlm,
  zModelCapabilitySource,
  zProviderType,
} from "@/lib/client/zod.gen";

const modelSchema = zLlm.extend({
  context_window_source: zModelCapabilitySource.optional(),
  vision_source: zModelCapabilitySource.optional(),
});

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export const providerSchema = z
  .object({
    id: z.string(),
    name: z.string().trim().min(1, "Provider name is required."),
    base_url: z.string().trim(),
    api_key: z.string().trim().min(1, "API key is required."),
    provider_type: zProviderType,
    models: z.array(modelSchema),
  })
  .superRefine((provider, context) => {
    if (provider.provider_type === "openai") {
      if (provider.base_url !== OPENAI_BASE_URL) {
        context.addIssue({
          code: "custom",
          path: ["base_url"],
          message: "OpenAI uses Asterism's fixed API URL.",
        });
      }
      return;
    }

    if (!provider.base_url) {
      context.addIssue({
        code: "custom",
        path: ["base_url"],
        message: "Base URL is required.",
      });
      return;
    }
    try {
      const url = new URL(provider.base_url);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        throw new Error("unsafe URL");
      }
    } catch {
      context.addIssue({
        code: "custom",
        path: ["base_url"],
        message:
          "Base URL must be an absolute HTTP(S) URL without credentials, query, or fragment.",
      });
    }
  });

type ProviderFormValue = ProvidersFormValues["llm_providers"][number];

const createEmptyProvider = (): ProviderFormValue => ({
  id: self.crypto.randomUUID(),
  name: "",
  base_url: "",
  api_key: "",
  provider_type: "generic_openai",
  models: [],
});

const providersFormSchema = z.object({
  llm_providers: z.array(providerSchema),
  draft_model_id: z.string().optional(),
});

type ProvidersFormValues = z.infer<typeof providersFormSchema>;

const ProvidersForm = ({
  appSettings,
}: {
  appSettings: ProviderSettings;
}) => {
  const queryClient = useQueryClient();
  const [loadingModelsIndex, setLoadingModelsIndex] = useState<number | null>(
    null,
  );

  const form = useForm<ProvidersFormValues>({
    resolver: zodResolver(providersFormSchema),
    defaultValues: {
      llm_providers: (appSettings?.llm_providers ?? []).map((provider) => ({
        ...provider,
        provider_type: provider.provider_type ?? "generic_openai",
      })),
      draft_model_id: appSettings?.draft_model_id ?? "",
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
  });

  const watchedProviders = useWatch({
    control,
    name: "llm_providers",
  });

  const watchedDraftModel = useWatch({
    control,
    name: "draft_model_id",
  });

  useEffect(() => {
    reset({
      llm_providers: (appSettings?.llm_providers ?? []).map((provider) => ({
        ...provider,
        provider_type: provider.provider_type ?? "generic_openai",
      })),
      draft_model_id: appSettings?.draft_model_id ?? "",
    });
  }, [appSettings, reset]);

  const availableModels = useMemo(() => {
    return watchedProviders
      .flatMap((p) =>
        p.models.map(
          (m) =>
            ({
              ...m,
              provider_name: p.name,
            }) as LlmDisplayInfo & { is_active: boolean },
        ),
      )
      .filter((m) => m.is_active);
  }, [watchedProviders]);

  const defaultModelList = useMemo(() => {
    return watchedProviders
      .flatMap((p) =>
        p.models.map((m) => ({
          ...m,
          provider: p.name,
        })),
      )
      .filter((m) => m.is_active)
      .map((m) => ({
        value: m.id,
        label: `${m.provider} - ${m.name}`,
      }));
  }, [watchedProviders]);

  const discoverModels = useMutation({
    ...appProviderModelsDiscoverMutation({ client }),
  });

  const saveProviders = useMutation({
    ...appProviderSettingsUpdateMutation({
      client,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: appProviderSettingsGetQueryKey({ client }),
      });
      toast.success("Settings saved");
    },
    onError: () => toast.error("Failed to save. Please try again."),
  });

  const onSubmit = (values: ProvidersFormValues) => {
    let draft_model_id: string | undefined = values.draft_model_id || undefined;

    if (draft_model_id == null && defaultModelList.length > 0) {
      draft_model_id = defaultModelList[0].value;
    }

    saveProviders.mutate({
      body: {
        llm_providers: values.llm_providers.map((provider) => ({
          ...provider,
          base_url:
            provider.provider_type === "openai"
              ? OPENAI_BASE_URL
              : provider.base_url.replace(/\/+$/, ""),
        })),
        draft_model_id: draft_model_id ?? null,
      },
    });
  };

  const handleLoadModels = async (index: number) => {
    const isProviderValid = await trigger([
      `llm_providers.${index}.name`,
      `llm_providers.${index}.provider_type`,
      `llm_providers.${index}.base_url`,
      `llm_providers.${index}.api_key`,
    ]);

    if (!isProviderValid) {
      return;
    }

    setLoadingModelsIndex(index);

    try {
      const provider = getValues(`llm_providers.${index}`);
      const discovery = await discoverModels.mutateAsync({
        body: {
          provider_type: provider.provider_type,
          base_url: provider.base_url,
          api_key: provider.api_key,
          provider_id: provider.id,
          existing_models: Object.values(provider.models ?? {}),
          draft_model_id: watchedDraftModel || null,
        },
      });
      setValue(`llm_providers.${index}.models`, discovery.models, {
        shouldDirty: true,
        shouldValidate: true,
      });
      toast.success(
        `Loaded ${discovery.models.length} models for ${provider.name}.`,
      );
      if ((discovery.warnings?.length ?? 0) > 0) {
        toast.warning(
          `${discovery.warnings?.length} capability fields need manual review.`,
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : typeof error === "object" && error && "detail" in error
            ? String(error.detail)
            : "Failed to load provider models. Please try again.",
      );
    } finally {
      setLoadingModelsIndex(null);
    }
  };

  return (
    <form
      id="providers-form"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden"
      onSubmit={handleSubmit(onSubmit)}
    >
      <div className="relative">
        <h1 className="border-b pb-2 text-base font-bold">
          OpenAI API Compatible Providers
        </h1>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => append(createEmptyProvider())}
          aria-label="Add provider"
          className="absolute top-0 right-0"
        >
          <PlusIcon />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {fields.length === 0 ? (
          <div className="text-muted-foreground bg-card m-3 flex flex-1 flex-col items-center justify-center gap-3 rounded border border-dashed p-4 text-sm">
            <ComputerIcon className="text-muted-foreground/50 size-10" />
            <h4 className="w-sm text-center text-xl">
              No providers configured yet. Add one to get started.
            </h4>
            <Button onClick={() => append(createEmptyProvider())}>
              <PlusIcon /> Add Provider
            </Button>
          </div>
        ) : null}

        {fields.map((field, index) => {
          const providerErrors = formState.errors.llm_providers?.[index];
          const provider = watchedProviders?.[index];
          const models = provider?.models ?? [];
          const isLoadingModels = loadingModelsIndex === index;

          return (
            <FieldSet
              key={field.id}
              className="bg-background/30 rounded border p-4"
            >
              <div className="flex min-h-0 items-start justify-between gap-3">
                <div>
                  <FieldTitle className="text-base! font-medium!">
                    {provider?.name?.trim() || `Provider ${index + 1}`}
                  </FieldTitle>
                </div>
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
                  id={`provider-id-${index}`}
                  {...register(`llm_providers.${index}.id`)}
                />
                <Field>
                  <FieldLabel htmlFor={`provider-type-${index}`}>
                    Provider Type
                  </FieldLabel>
                  <FieldContent>
                    <Controller
                      control={control}
                      name={`llm_providers.${index}.provider_type`}
                      render={({ field: controllerField }) => (
                        <Select
                          value={controllerField.value}
                          onValueChange={(value) => {
                            const providerType = value as
                              | "openai"
                              | "generic_openai";
                            controllerField.onChange(providerType);
                            setValue(
                              `llm_providers.${index}.base_url`,
                              providerType === "openai"
                                ? OPENAI_BASE_URL
                                : getValues(
                                      `llm_providers.${index}.base_url`,
                                    ) === OPENAI_BASE_URL
                                  ? ""
                                  : getValues(
                                      `llm_providers.${index}.base_url`,
                                    ),
                              { shouldDirty: true, shouldValidate: true },
                            );
                          }}
                        >
                          <SelectTrigger
                            id={`provider-type-${index}`}
                            className="w-full"
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
                      )}
                    />
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel htmlFor={`provider-name-${index}`}>
                    Provider Name
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      id={`provider-name-${index}`}
                      aria-invalid={providerErrors?.name ? true : undefined}
                      {...register(`llm_providers.${index}.name`)}
                      autoComplete="nope"
                    />
                    <FieldError errors={[providerErrors?.name]} />
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel htmlFor={`provider-base-url-${index}`}>
                    Base URL
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      id={`provider-base-url-${index}`}
                      aria-invalid={providerErrors?.base_url ? true : undefined}
                      placeholder="https://api.example.com/v1"
                      readOnly={provider?.provider_type === "openai"}
                      aria-readonly={
                        provider?.provider_type === "openai" ? true : undefined
                      }
                      {...register(`llm_providers.${index}.base_url`)}
                      autoComplete="nope"
                    />
                    <FieldError errors={[providerErrors?.base_url]} />
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
                      aria-invalid={providerErrors?.api_key ? true : undefined}
                      {...register(`llm_providers.${index}.api_key`)}
                      autoComplete="nope"
                    />
                    <FieldError errors={[providerErrors?.api_key]} />
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel>Models</FieldLabel>
                  <FieldContent className="gap-2">
                    <div className="flex flex-wrap items-center gap-2 overflow-y-auto">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleLoadModels(index)}
                        disabled={isLoadingModels}
                      >
                        {isLoadingModels ? (
                          <LoaderCircleIcon className="animate-spin" />
                        ) : (
                          <RefreshCwIcon />
                        )}
                        Load models
                      </Button>
                    </div>

                    {models.length > 0 ? (
                      <div className="grid max-h-96 min-h-0 gap-3 overflow-y-auto rounded border p-2">
                        {models.map((model, modelIndex) => {
                          const modelErrors =
                            providerErrors?.models?.[modelIndex];
                          const contextSource =
                            model.context_window_source ?? "unknown";
                          const visionSource = model.vision_source ?? "unknown";
                          return (
                            <div
                              key={`${field.id}-${model.name}-${modelIndex}`}
                              className="grid gap-3 rounded p-3 md:grid-cols-[minmax(10rem,1fr)_minmax(9rem,12rem)_minmax(9rem,12rem)]"
                            >
                              <Input
                                type="hidden"
                                {...register(
                                  `llm_providers.${index}.models.${modelIndex}.id`,
                                )}
                              />
                              <Input
                                type="hidden"
                                {...register(
                                  `llm_providers.${index}.models.${modelIndex}.name`,
                                )}
                              />
                              <Input
                                type="hidden"
                                {...register(
                                  `llm_providers.${index}.models.${modelIndex}.provider_id`,
                                )}
                              />
                              <div className="flex items-center gap-2">
                                <Controller
                                  control={control}
                                  name={`llm_providers.${index}.models.${modelIndex}.is_active`}
                                  render={({ field: controllerField }) => (
                                    <Checkbox
                                      id={`provider-${index}-model-${modelIndex}-active`}
                                      checked={controllerField.value}
                                      onCheckedChange={(checked) => {
                                        const isActive = checked === true;
                                        controllerField.onChange(isActive);
                                        if (
                                          !isActive &&
                                          watchedDraftModel === model.id
                                        ) {
                                          const nextDefault = watchedProviders
                                            ?.flatMap((item) =>
                                              item.models
                                                .filter(
                                                  (candidate) =>
                                                    candidate.id !== model.id &&
                                                    candidate.is_active,
                                                )
                                                .map(
                                                  (candidate) => candidate.id,
                                                ),
                                            )
                                            .at(0);
                                          setValue(
                                            "draft_model_id",
                                            nextDefault,
                                            {
                                              shouldDirty: true,
                                              shouldValidate: true,
                                            },
                                          );
                                        }
                                      }}
                                    />
                                  )}
                                />
                                <FieldLabel
                                  htmlFor={`provider-${index}-model-${modelIndex}-active`}
                                >
                                  {model.name}
                                </FieldLabel>
                              </div>

                              <Field>
                                <FieldLabel
                                  htmlFor={`provider-${index}-model-${modelIndex}-context`}
                                >
                                  Context window
                                </FieldLabel>
                                <Controller
                                  control={control}
                                  name={`llm_providers.${index}.models.${modelIndex}.context_window`}
                                  render={({ field: controllerField }) => (
                                    <Input
                                      id={`provider-${index}-model-${modelIndex}-context`}
                                      type="number"
                                      min={1}
                                      step={1}
                                      value={controllerField.value ?? ""}
                                      aria-invalid={
                                        modelErrors?.context_window
                                          ? true
                                          : undefined
                                      }
                                      placeholder="Unknown"
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        controllerField.onChange(
                                          value === "" ? null : Number(value),
                                        );
                                        setValue(
                                          `llm_providers.${index}.models.${modelIndex}.context_window_source`,
                                          value === "" ? "unknown" : "manual",
                                          { shouldDirty: true },
                                        );
                                      }}
                                    />
                                  )}
                                />
                                <span
                                  className={
                                    contextSource === "unknown"
                                      ? "text-xs text-amber-700 dark:text-amber-400"
                                      : "text-muted-foreground text-xs"
                                  }
                                >
                                  Source: {contextSource}
                                </span>
                                <FieldError
                                  errors={[modelErrors?.context_window]}
                                />
                              </Field>

                              <Field>
                                <FieldLabel
                                  htmlFor={`provider-${index}-model-${modelIndex}-vision`}
                                >
                                  Vision input
                                </FieldLabel>
                                <Controller
                                  control={control}
                                  name={`llm_providers.${index}.models.${modelIndex}.supports_vision`}
                                  render={({ field: controllerField }) => (
                                    <Select
                                      value={
                                        controllerField.value == null
                                          ? "unknown"
                                          : String(controllerField.value)
                                      }
                                      onValueChange={(value) => {
                                        controllerField.onChange(
                                          value === "unknown"
                                            ? null
                                            : value === "true",
                                        );
                                        setValue(
                                          `llm_providers.${index}.models.${modelIndex}.vision_source`,
                                          value === "unknown"
                                            ? "unknown"
                                            : "manual",
                                          { shouldDirty: true },
                                        );
                                      }}
                                    >
                                      <SelectTrigger
                                        id={`provider-${index}-model-${modelIndex}-vision`}
                                        className="w-full"
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="unknown">
                                          Unknown
                                        </SelectItem>
                                        <SelectItem value="true">
                                          Supported
                                        </SelectItem>
                                        <SelectItem value="false">
                                          Not supported
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  )}
                                />
                                <span
                                  className={
                                    visionSource === "unknown"
                                      ? "text-xs text-amber-700 dark:text-amber-400"
                                      : "text-muted-foreground text-xs"
                                  }
                                >
                                  Source: {visionSource}
                                </span>
                              </Field>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-sm">
                        No models loaded yet.
                      </div>
                    )}
                  </FieldContent>
                </Field>
              </FieldGroup>
            </FieldSet>
          );
        })}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-row items-center gap-2">
          <Field orientation="horizontal">
            <FieldLabel htmlFor="appsettings-draft-model">
              Draft Model
              <HelpIcon text="The model used for generating chat titles and other background information." />
            </FieldLabel>
            <Controller
              control={control}
              name="draft_model_id"
              render={({ field }) => (
                <ModelSelector
                  className="w-40! sm:w-80!"
                  id="appsettings-draft-model"
                  defaultModel={field.value}
                  availableModels={availableModels}
                  onValueChange={field.onChange}
                />
              )}
            />
          </Field>
        </div>
        <div className="flex flex-1 items-center justify-end gap-2">
          <Button type="submit" disabled={saveProviders.isPending}>
            {saveProviders.isPending ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <SaveIcon />
            )}
            Save
          </Button>
        </div>
      </div>
    </form>
  );
};

export const ProvidersTab = ({
  appSettings,
}: {
  appSettings?: ProviderSettings;
}) => {
  const providerSettings = useQuery({
    ...appProviderSettingsGetOptions({ client }),
    enabled: appSettings === undefined,
  });
  const settings = appSettings ?? providerSettings.data;

  if (appSettings === undefined && providerSettings.isLoading) {
    return <Spinner />;
  }
  if (providerSettings.isError || settings == null) {
    return <p role="alert">Provider settings could not be loaded.</p>;
  }

  return <ProvidersForm appSettings={settings} />;
};
