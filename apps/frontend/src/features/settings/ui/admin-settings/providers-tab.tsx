"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import {
  ComputerIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { HelpIcon } from "@/components/help-icon";
import { ModelSelector } from "@/components/settings/model-selector";
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
import { fetchProviderModels } from "@/features/settings/server/actions";
import { client } from "@/lib/api";
import { ApplicationSettings, Llm, LlmDisplayInfo } from "@/lib/client";
import { appSettingsBulkUpdateMutation } from "@/lib/client/@tanstack/react-query.gen";
import { zLlm } from "@/lib/client/zod.gen";
import { useRouter } from "next/navigation";

const providerSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1, "Provider name is required."),
  base_url: z
    .url("Base URL must be a valid URL.")
    .trim()
    .min(1, "Base URL is required.")
    .transform((arg) => (arg.endsWith("/") ? arg.slice(0, -1) : arg)),
  api_key: z.string().trim().min(1, "API key is required."),
  models: z.array(zLlm),
});

type ProviderFormValue = ProvidersFormValues["llm_providers"][number];

const createEmptyProvider = (): ProviderFormValue => ({
  id: self.crypto.randomUUID(),
  name: "",
  base_url: "",
  api_key: "",
  models: [],
});

const providersFormSchema = z.object({
  llm_providers: z.array(providerSchema),
  draft_model_id: z.string().optional(),
});

type ProvidersFormValues = z.infer<typeof providersFormSchema>;

const mergeModels = (currentModels: Llm[], fetchedModels: Llm[]): Llm[] => {
  const currentByName = new Map(
    currentModels.map((model) => [model.name, model]),
  );
  return fetchedModels.map((model) => ({
    ...model,
    id: currentByName.get(model.name)?.id ?? model.id,
    is_active: currentByName.get(model.name)?.is_active ?? model.is_active,
  }));
};

export const ProvidersTab = ({
  appSettings,
}: {
  appSettings: ApplicationSettings;
}) => {
  const router = useRouter();
  const [loadingModelsIndex, setLoadingModelsIndex] = useState<number | null>(
    null,
  );

  const form = useForm<ProvidersFormValues>({
    resolver: zodResolver(providersFormSchema),
    defaultValues: {
      llm_providers: appSettings?.llm_providers ?? [],
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
      llm_providers: appSettings?.llm_providers ?? [],
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

  const saveProviders = useMutation({
    ...appSettingsBulkUpdateMutation({
      client,
    }),
    onSuccess: () => {
      toast.success("Settings saved");
      router.refresh();
    },
    onError: () => toast.error("Failed to save. Please try again."),
  });

  const onSubmit = (values: ProvidersFormValues) => {
    let draft_model_id: string | undefined = values.draft_model_id;

    if (draft_model_id == null && defaultModelList.length > 0) {
      draft_model_id = defaultModelList[0].value;
    }

    saveProviders.mutate({
      body: {
        values: {
          llm_providers: values.llm_providers,
          draft_model_id: draft_model_id ?? null,
        },
      },
    });
  };

  const handleLoadModels = async (index: number) => {
    const isProviderValid = await trigger([
      `llm_providers.${index}.name`,
      `llm_providers.${index}.base_url`,
      `llm_providers.${index}.api_key`,
    ]);

    if (!isProviderValid) {
      return;
    }

    setLoadingModelsIndex(index);

    try {
      const provider = getValues(`llm_providers.${index}`);
      const fetchedModels = await fetchProviderModels(
        provider.base_url,
        provider.id,
      );
      const mergedModels = mergeModels(
        Object.values(provider.models ?? {}),
        fetchedModels,
      );
      setValue(`llm_providers.${index}.models`, mergedModels, {
        shouldDirty: true,
        shouldValidate: true,
      });
      toast.success(
        `Loaded ${mergedModels.length} models for ${provider.name}.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load provider models. Please try again.",
      );
    } finally {
      setLoadingModelsIndex(null);
    }
  };

  return (
    <form
      id="providers-form"
      className="flex flex-1 flex-col gap-4 overflow-hidden"
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
              <div className="flex items-start justify-between gap-3">
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
                  <FieldLabel htmlFor={`provider-name-${index}`}>
                    Provider Name
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      id={`provider-name-${index}`}
                      aria-invalid={providerErrors?.name ? true : undefined}
                      {...register(`llm_providers.${index}.name`)}
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
                      {...register(`llm_providers.${index}.base_url`)}
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
                    />
                    <FieldError errors={[providerErrors?.api_key]} />
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel>Models</FieldLabel>
                  <FieldContent className="gap-2">
                    <div className="flex flex-wrap items-center gap-2">
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
                      <div className="grid gap-2 sm:grid-cols-2">
                        {models.map((model, modelIndex) => (
                          <Fragment key={`${field.id}-${model.name}`}>
                            <Input
                              type="hidden"
                              {...register(
                                `llm_providers.${index}.models.${modelIndex}.provider_id`,
                              )}
                            />
                            <Field
                              key={`${field.id}-${model.name}`}
                              orientation="horizontal"
                            >
                              <Controller
                                control={control}
                                name={`llm_providers.${index}.models.${modelIndex}.is_active`}
                                render={({ field: controllerField }) => (
                                  <Checkbox
                                    checked={controllerField.value}
                                    onCheckedChange={(checked) => {
                                      const isActive = checked === true;
                                      const currentValue = model.id;
                                      controllerField.onChange(isActive);
                                      if (
                                        !isActive &&
                                        watchedDraftModel === currentValue
                                      ) {
                                        const nextDefault = watchedProviders
                                          ?.flatMap((p) =>
                                            p.models
                                              .filter((m) => {
                                                return (
                                                  m.id != model.id &&
                                                  m.is_active
                                                );
                                              })
                                              .map((m) => m.id),
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
                              <FieldLabel>
                                <span>{model.name}</span>
                              </FieldLabel>
                            </Field>
                          </Fragment>
                        ))}
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
        <div className="flex items-center gap-2">
          <Field>
            <FieldLabel htmlFor="appsettings-draft-model" className="px-1">
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
