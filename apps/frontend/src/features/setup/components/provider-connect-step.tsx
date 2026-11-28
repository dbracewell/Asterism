"use client";

import {
  PROVIDER_TYPES,
  ProviderIcon,
} from "@/components/settings/model-identity";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  OPENAI_BASE_URL,
  type ProviderFormValues,
} from "@/features/settings/provider-schema";
import { client } from "@/lib/api";
import type {
  ProviderSettings,
  ProviderSummary,
  ProviderType,
} from "@/lib/client";
import {
  appProviderModelsDiscoverAndSyncMutation,
  appProviderSettingsUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Controller, type UseFormReturn, useWatch } from "react-hook-form";
import {
  actionClassName,
  errorSuffix,
  useErrorSummary,
  ErrorSummary,
  SkipLink,
} from "./provider-setup-shared";

const PROVIDER_CHOICES: { type: ProviderType; detail: string }[] = [
  { type: "openai", detail: "Uses the OpenAI API at api.openai.com." },
  {
    type: "generic_openai",
    detail: "Any OpenAI-compatible endpoint, hosted or local.",
  },
];

export const newProvider = (): ProviderFormValues => ({
  id: self.crypto.randomUUID(),
  name: PROVIDER_TYPES.openai.label,
  base_url: OPENAI_BASE_URL,
  api_key: "",
  provider_type: "openai",
  service: null,
});

/** Saved providers echo a redacted key, which the backend reads as "keep". */
export const savedApiKey = (provider: ProviderSummary) =>
  (provider as ProviderSummary & { api_key?: string }).api_key ?? "";

export const savedProvider = (
  provider: ProviderSummary,
): ProviderFormValues => ({
  id: provider.id,
  name: provider.name,
  base_url: provider.base_url,
  api_key: savedApiKey(provider),
  provider_type: provider.provider_type ?? "generic_openai",
  service: provider.service ?? null,
});

export function ConnectStep({
  form,
  settings,
  onConnected,
  onImport,
}: {
  form: UseFormReturn<ProviderFormValues>;
  settings: ProviderSettings;
  onConnected: (providerId: string) => void;
  onImport: () => void;
}) {
  const { control, formState, getValues, handleSubmit, setValue } = form;
  const { errorRef, error, showError, clearError } = useErrorSummary();
  const saveProviders = useMutation(
    appProviderSettingsUpdateMutation({ client }),
  );
  const discover = useMutation(
    appProviderModelsDiscoverAndSyncMutation({ client }),
  );
  const pending = saveProviders.isPending || discover.isPending;
  const failed = error != null;

  const changeType = (type: ProviderType) => {
    const options = {
      shouldDirty: true,
      shouldValidate: formState.isSubmitted,
    };
    const name = getValues("name").trim();
    const baseUrl = getValues("base_url");
    setValue("provider_type", type, options);
    if (type !== "generic_openai") setValue("service", null, options);
    if (!name || name === PROVIDER_TYPES.openai.label) {
      setValue(
        "name",
        type === "openai" ? PROVIDER_TYPES.openai.label : "",
        options,
      );
    }
    setValue(
      "base_url",
      type === "openai"
        ? OPENAI_BASE_URL
        : baseUrl === OPENAI_BASE_URL
          ? ""
          : baseUrl,
      options,
    );
  };

  const connect = async (values: ProviderFormValues) => {
    clearError();
    const others = (settings.llm_providers ?? [])
      .filter((provider) => provider.id !== values.id)
      .map((provider) => ({ ...provider, api_key: savedApiKey(provider) }));
    try {
      await saveProviders.mutateAsync({
        body: {
          llm_providers: [...others, values],
          draft_model_id: settings.draft_model_id ?? null,
        },
      });
    } catch (cause) {
      showError(`The provider could not be saved.${errorSuffix(cause)}`);
      return;
    }
    try {
      const provider = await discover.mutateAsync({
        path: { provider_id: values.id },
      });
      if (!provider.model_count) {
        showError(
          "The provider returned no models. Check the base URL, then retry.",
        );
        return;
      }
      onConnected(values.id);
    } catch (cause) {
      showError(
        `Model discovery failed.${errorSuffix(cause)} Check the base URL and API key, then retry.`,
      );
    }
  };

  const errors = formState.errors;
  return (
    <form
      aria-label="Add a model provider"
      aria-describedby={failed ? "setup-provider-error" : undefined}
      onSubmit={handleSubmit(connect)}
    >
      <FieldGroup>
        <ErrorSummary
          id="setup-provider-error"
          ref={errorRef}
          message={error}
        />
        <Controller
          control={control}
          name="provider_type"
          render={({ field }) => (
            <FieldSet>
              <FieldLegend variant="label">Provider type</FieldLegend>
              <RadioGroup
                value={field.value}
                onValueChange={(value) => changeType(value as ProviderType)}
                className="grid-cols-1 sm:grid-cols-2"
                disabled={pending}
              >
                {PROVIDER_CHOICES.map(({ type, detail }) => (
                  <FieldLabel
                    key={type}
                    htmlFor={`setup-provider-type-${type}`}
                    className="min-w-0"
                  >
                    <Field orientation="horizontal">
                      <RadioGroupItem
                        value={type}
                        id={`setup-provider-type-${type}`}
                        aria-labelledby={`setup-provider-type-${type}-label`}
                        aria-describedby={`setup-provider-type-${type}-detail`}
                      />
                      <FieldContent className="min-w-0">
                        <FieldTitle id={`setup-provider-type-${type}-label`}>
                          <ProviderIcon type={type} />
                          {PROVIDER_TYPES[type].label}
                        </FieldTitle>
                        <FieldDescription
                          id={`setup-provider-type-${type}-detail`}
                          className="wrap-anywhere"
                        >
                          {detail}
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </FieldSet>
          )}
        />
        <ProviderFields
          form={form}
          disabled={pending}
          errors={{
            name: errors.name?.message,
            base_url: errors.base_url?.message,
            api_key: errors.api_key?.message,
          }}
        />
        <Field>
          <Button type="submit" className={actionClassName} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {pending
              ? "Connecting…"
              : failed
                ? "Retry"
                : "Connect and discover models"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={actionClassName}
            onClick={onImport}
          >
            Import a settings file instead
          </Button>
          <SkipLink />
        </Field>
      </FieldGroup>
    </form>
  );
}

function ProviderFields({
  form,
  disabled,
  errors,
}: {
  form: UseFormReturn<ProviderFormValues>;
  disabled: boolean;
  errors: Partial<Record<"name" | "base_url" | "api_key", string>>;
}) {
  const { control, register } = form;
  const type = useWatch({ control, name: "provider_type" });
  const field = (
    name: "name" | "base_url" | "api_key",
    label: string,
    input: React.ComponentProps<typeof Input>,
    description?: string,
  ) => (
    <Field data-invalid={errors[name] ? true : undefined}>
      <FieldLabel htmlFor={`setup-provider-${name}`}>{label}</FieldLabel>
      <Input
        data-1p-ignore
        id={`setup-provider-${name}`}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={
          description ? `setup-provider-${name}-description` : undefined
        }
        disabled={disabled}
        {...input}
        {...register(name)}
      />
      {description && (
        <FieldDescription id={`setup-provider-${name}-description`}>
          {description}
        </FieldDescription>
      )}
      <FieldError>{errors[name]}</FieldError>
    </Field>
  );

  return (
    <>
      {field("name", "Provider name", { autoComplete: "off" })}
      {type === "openai"
        ? field(
            "base_url",
            "Base URL",
            { readOnly: true },
            "OpenAI always uses this URL.",
          )
        : field("base_url", "Base URL", {
            placeholder: "http://localhost:11434/v1",
            inputMode: "url",
          })}
      {field(
        "api_key",
        "API key",
        { type: "password", autoComplete: "off" },
        type === "openai"
          ? undefined
          : "Local servers that don't check keys accept any value.",
      )}
    </>
  );
}
