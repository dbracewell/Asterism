"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

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
  appSettingsBulkUpdateMutation,
  appSettingsGetOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { client } from "@/lib/api";
import { fetchProviderModels } from "@/features/settings/server/actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LlmModel, LlmProviderModel } from "@/lib/client";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";

const providerModelSchema = z.object({
  name: z.string().min(1, "Model name is required."),
  is_active: z.boolean(),
});

const providerSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1, "Provider name is required."),
  base_url: z
    .url("Base URL must be a valid URL.")
    .trim()
    .min(1, "Base URL is required.")
    .transform((arg) => (arg.endsWith("/") ? arg.slice(0, -1) : arg)),
  api_key: z.string().trim().min(1, "API key is required."),
  models: z.array(providerModelSchema),
});

const providersFormSchema = z.object({
  llm_providers: z.array(providerSchema),
  default_model: z.string().optional(),
});

type ProvidersFormValues = z.infer<typeof providersFormSchema>;
type ProviderFormValue = ProvidersFormValues["llm_providers"][number];

const createEmptyProvider = (): ProviderFormValue => ({
  id: self.crypto.randomUUID(),
  name: "",
  base_url: "",
  api_key: "",
  models: [],
});

const mergeModels = (
  currentModels: LlmProviderModel[],
  fetchedModels: LlmProviderModel[],
): LlmProviderModel[] => {
  const currentByName = new Map(
    currentModels.map((model) => [model.name, model.is_active]),
  );

  return fetchedModels.map((model) => ({
    ...model,
    is_active: currentByName.get(model.name) ?? model.is_active,
  }));
};

const toDefaultModelValue = (defaultModel?: LlmModel) => {
  return defaultModel?.provider_id && defaultModel.name
    ? `${defaultModel.provider_id}::${defaultModel.name}`
    : undefined;
};

export const ProvidersTab = () => {
  const router = useRouter();
  const [loadingModelsIndex, setLoadingModelsIndex] = useState<number | null>(
    null,
  );

  const {
    data: appSettings,
    isLoading,
    isSuccess,
  } = useQuery({
    ...appSettingsGetOptions({
      client,
    }),
  });

  const form = useForm<ProvidersFormValues>({
    resolver: zodResolver(providersFormSchema),
    defaultValues: {
      llm_providers: appSettings?.llm_providers ?? [],
      default_model: toDefaultModelValue(appSettings?.default_model),
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

  const watchedDefaultModel = useWatch({
    control,
    name: "default_model",
  });

  useEffect(() => {
    if (!isSuccess || formState.isDirty) {
      return;
    }
    reset({
      llm_providers: appSettings?.llm_providers ?? [],
      default_model: toDefaultModelValue(appSettings?.default_model),
    });
  }, [appSettings, formState.isDirty, isSuccess, reset]);

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

  const defaultModelList = useMemo(() => {
    return watchedProviders
      .flatMap((p) => p.models.map((m) => [p.name, p.id, m.name, m.is_active]))
      .filter((m) => m[3])
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      .map(([provider_name, id, name, _]) => ({
        value: `${id}::${name}`,
        label: `${provider_name} - ${name}`,
      }));
  }, [watchedProviders]);

  const onSubmit = (values: ProvidersFormValues) => {
    let default_model: LlmModel | undefined = undefined;
    if (values.default_model) {
      const parts = values.default_model.split("::");
      default_model = { provider_id: parts[0], name: parts[1] };
    } else if (defaultModelList.length > 0) {
      const parts = defaultModelList[0].value.split("::");
      default_model = { provider_id: parts[0], name: parts[1] };
    }

    saveProviders.mutate({
      body: {
        values: {
          llm_providers: values.llm_providers,
          default_model,
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
      const fetchedModels = await fetchProviderModels(provider.base_url);
      const mergedModels = mergeModels(provider.models, fetchedModels);

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

  if (isLoading) {
    return <Spinner />;
  }

  return (
    <form
      className="flex w-full flex-1 flex-col gap-4 overflow-y-auto py-2"
      noValidate
      onSubmit={handleSubmit(onSubmit)}
    >
      <div className="relative">
        <h1 className="border-b pb-2 font-bold">
          OpenAI API Compatible Providers
        </h1>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => append(createEmptyProvider())}
          disabled={isLoading && !isSuccess}
          aria-label="Add provider"
          className="absolute top-0 right-0"
        >
          <PlusIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {isLoading && fields.length === 0 ? (
          <div className="text-muted-foreground py-4 text-sm">
            Loading providers...
          </div>
        ) : null}

        {!isLoading && fields.length === 0 ? (
          <div className="text-muted-foreground rounded border border-dashed p-4 text-sm">
            No providers configured yet. Add one to get started.
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
                                    const currentValue = `${provider?.id}::${model.name}`;

                                    controllerField.onChange(isActive);
                                    console.log(
                                      isActive,
                                      currentValue,
                                      watchedDefaultModel,
                                    );
                                    if (
                                      !isActive &&
                                      watchedDefaultModel === currentValue
                                    ) {
                                      const nextDefault = watchedProviders
                                        ?.flatMap((p) =>
                                          p.models
                                            .filter((m) => {
                                              if (
                                                p.id === provider?.id &&
                                                m.name === model.name
                                              ) {
                                                return false;
                                              }
                                              return m.is_active;
                                            })
                                            .map((m) => `${p.id}::${m.name}`),
                                        )
                                        .at(0);
                                      console.log(nextDefault);
                                      setValue("default_model", nextDefault, {
                                        shouldDirty: true,
                                        shouldValidate: true,
                                      });
                                    }
                                  }}
                                />
                              )}
                            />
                            <FieldLabel>
                              <span>{model.name}</span>
                            </FieldLabel>
                          </Field>
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
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Field>
            <FieldLabel htmlFor="appsettings-default-model">
              Default Model
            </FieldLabel>
            <Controller
              control={control}
              name="default_model"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  defaultValue={toDefaultModelValue(appSettings?.default_model)}
                >
                  <SelectTrigger>
                    <SelectValue
                      id="appsettings-default-model"
                      className="w-full max-w-2xl"
                      placeholder="Choose the default model"
                    />
                  </SelectTrigger>
                  <SelectContent className="w-full max-w-2xl truncate">
                    {defaultModelList.map((df) => (
                      <SelectItem
                        className="w-full max-w-2xl truncate"
                        value={df.value}
                        key={df.value}
                      >
                        {df.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
