"use client";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  apiKeyRequired,
  OPENAI_BASE_URL,
  type ProviderFormValues,
} from "@/features/settings/provider-schema";
import {
  applyChoice,
  choiceOf,
  OPENAI_LABEL,
  serviceEntry,
  type ServiceChoice,
} from "@/features/settings/provider-services";
import {
  LocalServerNote,
  ServiceSelect,
} from "@/features/settings/ui/provider-service-select";
import { client } from "@/lib/api";
import type { ProviderSettings, ProviderSummary } from "@/lib/client";
import {
  appProviderModelsDiscoverAndSyncMutation,
  appProviderServicesListOptions,
  appProviderSettingsUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { type UseFormReturn, useWatch } from "react-hook-form";
import {
  actionClassName,
  errorSuffix,
  useErrorSummary,
  ErrorSummary,
  SkipLink,
} from "./provider-setup-shared";

export const newProvider = (): ProviderFormValues => ({
  id: self.crypto.randomUUID(),
  name: OPENAI_LABEL,
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
  const services = useQuery(appProviderServicesListOptions({ client }));
  const pending = saveProviders.isPending || discover.isPending;
  const failed = error != null;

  const providerType = useWatch({ control, name: "provider_type" });
  const service = useWatch({ control, name: "service" });
  const choice = choiceOf({ provider_type: providerType, service });
  const changeChoice = (next: ServiceChoice) => {
    const options = {
      shouldDirty: true,
      shouldValidate: formState.isSubmitted,
    };
    const values = applyChoice(
      { name: getValues("name"), base_url: getValues("base_url") },
      choice,
      next,
      services.data,
    );
    setValue("provider_type", values.provider_type, options);
    setValue("service", values.service, options);
    setValue("name", values.name, options);
    setValue("base_url", values.base_url, options);
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
        <Field>
          <FieldLabel htmlFor="setup-provider-service">Service</FieldLabel>
          <ServiceSelect
            id="setup-provider-service"
            value={choice}
            onChange={changeChoice}
            catalog={services.data}
            disabled={pending}
          />
          <FieldDescription>
            Pick the service to fill in its URL, or Custom for any other
            OpenAI-compatible endpoint.
          </FieldDescription>
        </Field>
        <ProviderFields
          form={form}
          local={serviceEntry(choice, services.data)?.group === "local"}
          keyOptional={
            !apiKeyRequired(
              { provider_type: providerType, service },
              services.data,
            )
          }
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
  local,
  keyOptional,
  disabled,
  errors,
}: {
  form: UseFormReturn<ProviderFormValues>;
  local: boolean;
  keyOptional: boolean;
  disabled: boolean;
  errors: Partial<Record<"name" | "base_url" | "api_key", string>>;
}) {
  const { control, register } = form;
  const type = useWatch({ control, name: "provider_type" });
  const baseUrl = useWatch({ control, name: "base_url" });
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
            placeholder: "https://api.example.com/v1",
            inputMode: "url",
          })}
      {local && (
        <LocalServerNote id="setup-provider-local-note" baseUrl={baseUrl} />
      )}
      {field(
        "api_key",
        "API key",
        { type: "password", autoComplete: "off" },
        keyOptional
          ? "Optional: leave it empty for a server that doesn't check keys."
          : undefined,
      )}
    </>
  );
}
