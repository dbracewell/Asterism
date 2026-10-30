"use client";

import { FormSkeleton, ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import {
  CapabilityIcons,
  PROVIDER_TYPES,
  ProviderIcon,
} from "@/components/settings/model-identity";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AuthHeading,
  authCardClassName,
  SetupSteps,
} from "@/features/auth/components/setup-steps";
import {
  OPENAI_BASE_URL,
  type ProviderFormValues,
  providerSchema,
} from "@/features/settings/provider-schema";
import { client } from "@/lib/api";
import type {
  Llm,
  ProviderSettings,
  ProviderSummary,
  ProviderType,
} from "@/lib/client";
import {
  appProviderModelsDiscoverAndSyncMutation,
  appProviderModelsListOptions,
  appProviderModelUpdateMutation,
  appProviderSettingsGetOptions,
  appProviderSettingsUpdateMutation,
  userSettingUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, XIcon } from "lucide-react";
import Link from "next/link";
import { type RefObject, useDeferredValue, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  Controller,
  type UseFormReturn,
  useForm,
  useWatch,
} from "react-hook-form";

const PAGE_SIZE = 20;
// Full-width actions wrap at large text sizes instead of overflowing the card.
const actionClassName = "h-auto min-h-7 w-full py-1 whitespace-normal";
const PROVIDER_CHOICES: { type: ProviderType; detail: string }[] = [
  { type: "openai", detail: "Uses the OpenAI API at api.openai.com." },
  {
    type: "generic_openai",
    detail: "Any OpenAI-compatible endpoint, hosted or local.",
  },
];

const newProvider = (): ProviderFormValues => ({
  id: self.crypto.randomUUID(),
  name: PROVIDER_TYPES.openai.label,
  base_url: OPENAI_BASE_URL,
  api_key: "",
  provider_type: "openai",
});

/** Saved providers echo a redacted key, which the backend reads as "keep". */
const savedApiKey = (provider: ProviderSummary) =>
  (provider as ProviderSummary & { api_key?: string }).api_key ?? "";

const savedProvider = (provider: ProviderSummary): ProviderFormValues => ({
  id: provider.id,
  name: provider.name,
  base_url: provider.base_url,
  api_key: savedApiKey(provider),
  provider_type: provider.provider_type ?? "generic_openai",
});

/** The API's safe error text, without its machine-readable category prefix. */
function errorDetail(error: unknown) {
  const detail =
    error &&
    typeof error === "object" &&
    "detail" in error &&
    typeof error.detail === "string"
      ? error.detail
      : null;
  return detail ? ` ${detail.replace(/^[a-z_]+: /, "")}` : "";
}

/** A focused error summary; repeated failures return focus to it. */
function useErrorSummary() {
  const ref = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const show = (text: string) => {
    flushSync(() => setMessage(text));
    ref.current?.focus();
    ref.current?.scrollIntoView({ block: "start" });
  };
  return {
    errorRef: ref,
    error: message,
    showError: show,
    clearError: () => setMessage(null),
  };
}

function ErrorSummary({
  id,
  ref,
  message,
}: {
  id: string;
  ref: RefObject<HTMLDivElement | null>;
  message: string | null;
}) {
  if (!message) return null;
  return (
    <FieldError
      ref={ref}
      id={id}
      tabIndex={-1}
      className="rounded-control scroll-mt-6 wrap-anywhere outline-offset-4 focus-visible:outline-2"
    >
      {message}
    </FieldError>
  );
}

function SkipLink() {
  return (
    <Button asChild variant="ghost" className={actionClassName}>
      <Link href="/">Skip for now</Link>
    </Button>
  );
}

/**
 * Step 2 of first-run setup: connect one provider, discover its models and
 * enable at least one. Rendered in the same card as the account step.
 */
export function ProviderSetupStep({
  className,
  // A full load gives the new-chat page the saved default model.
  onComplete = () => window.location.assign("/"),
}: {
  className?: string;
  onComplete?: () => void;
}) {
  const settings = useQuery(appProviderSettingsGetOptions({ client }));
  const [done, setDone] = useState(false);

  return (
    <div className={cn(authCardClassName, "max-w-lg", className)}>
      <FieldGroup>
        <AuthHeading description="Set up your Asterism instance" />
        <SetupSteps current={done ? 2 : 1} />
        {done ? (
          <p role="status" className="text-body text-center">
            Provider connected. Opening your first chat…
          </p>
        ) : settings.isLoading ? (
          <FormSkeleton label="Loading provider settings…" fields={4} />
        ) : settings.isError || !settings.data ? (
          <QueryError
            error={settings.error}
            message="Provider settings could not be loaded."
            retry={() => settings.refetch()}
            isRetrying={settings.isRefetching}
          />
        ) : (
          <ProviderSetupFlow
            settings={settings.data}
            onDone={() => {
              setDone(true);
              onComplete();
            }}
          />
        )}
      </FieldGroup>
    </div>
  );
}

function ProviderSetupFlow({
  settings,
  onDone,
}: {
  settings: ProviderSettings;
  onDone: () => void;
}) {
  // Resume a provider saved before a reload rather than adding a second one.
  const saved = settings.llm_providers?.[0];
  const form = useForm<ProviderFormValues>({
    resolver: zodResolver(providerSchema),
    defaultValues: saved ? savedProvider(saved) : newProvider(),
    mode: "onBlur",
  });
  const [connected, setConnected] = useState(
    saved && (saved.model_count ?? 0) > 0 ? saved.id : null,
  );

  return connected ? (
    <ModelStep
      providerId={connected}
      providerName={form.getValues("name")}
      onBack={() => setConnected(null)}
      onDone={onDone}
    />
  ) : (
    <ConnectStep form={form} settings={settings} onConnected={setConnected} />
  );
}

function ConnectStep({
  form,
  settings,
  onConnected,
}: {
  form: UseFormReturn<ProviderFormValues>;
  settings: ProviderSettings;
  onConnected: (providerId: string) => void;
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
      showError(`The provider could not be saved.${errorDetail(cause)}`);
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
        `Model discovery failed.${errorDetail(cause)} Check the base URL and API key, then retry.`,
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

function ModelStep({
  providerId,
  providerName,
  onBack,
  onDone,
}: {
  providerId: string;
  providerName: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const { errorRef, error, showError, clearError } = useErrorSummary();
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim());
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<(string | null)[]>([]);
  const catalog = useQuery({
    ...appProviderModelsListOptions({
      client,
      path: { provider_id: providerId },
      query: { query, cursor: cursor ?? undefined, limit: PAGE_SIZE },
    }),
    placeholderData: keepPreviousData,
  });
  const [selected, setSelected] = useState<Record<string, Llm>>({});
  const [chosenDefault, setChosenDefault] = useState<string | null>(null);
  const enabled = Object.values(selected);
  const defaultId =
    chosenDefault && selected[chosenDefault]
      ? chosenDefault
      : (enabled[0]?.id ?? null);
  // The page navigates away on success, so skip app-wide refetches per save.
  const meta = { skipGlobalInvalidation: true };
  const updateModel = useMutation({
    ...appProviderModelUpdateMutation({ client }),
    meta,
  });
  const updateSetting = useMutation({
    ...userSettingUpdateMutation({ client }),
    meta,
  });
  const pending = updateModel.isPending || updateSetting.isPending;

  const toggle = (model: Llm, on: boolean) =>
    setSelected((current) => {
      const next = { ...current };
      if (on) next[model.id] = model;
      else delete next[model.id];
      return next;
    });

  const changeSearch = (value: string) => {
    setSearch(value);
    setCursor(null);
    setPreviousCursors([]);
  };

  const finish = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!defaultId) {
      showError("Enable at least one model to continue.");
      return;
    }
    clearError();
    try {
      for (const model of enabled) {
        await updateModel.mutateAsync({
          path: { provider_id: providerId, model_id: model.id },
          body: {
            is_active: true,
            context_window: model.context_window ?? null,
            supports_vision: model.supports_vision,
            supports_tools: model.supports_tools,
            tools_source: model.tools_source,
            context_window_source: model.context_window_source,
            vision_source: model.vision_source,
          },
        });
      }
      await updateSetting.mutateAsync({
        path: { key: "default_model_id" },
        body: { value: defaultId },
      });
    } catch (cause) {
      showError(
        `The selected models could not be enabled.${errorDetail(cause)} Your choices are kept; retry Continue.`,
      );
      return;
    }
    onDone();
  };

  const models = catalog.data?.models ?? [];
  const total = catalog.data?.total ?? 0;
  return (
    <form
      aria-label="Enable models"
      aria-describedby={error ? "setup-models-error" : undefined}
      onSubmit={(event) => void finish(event)}
    >
      <FieldGroup>
        <ErrorSummary id="setup-models-error" ref={errorRef} message={error} />
        <FieldSet disabled={pending} className="min-w-0">
          <FieldLegend variant="label" className="wrap-anywhere">
            Enable models from {providerName}
          </FieldLegend>
          <FieldDescription>
            Enabled models are available to everyone on this instance. You can
            change them later in Admin settings → Providers.
          </FieldDescription>
          <InputGroup>
            <InputGroupInput
              aria-label="Search models"
              placeholder="Search models"
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
            />
            {search && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  aria-label="Clear model search"
                  size="icon-xs"
                  onClick={() => changeSearch("")}
                >
                  <XIcon />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
          {catalog.isLoading ? (
            <ListSkeleton label="Loading models…" rows={4} />
          ) : catalog.isError ? (
            <QueryError
              error={catalog.error}
              message="Models could not be loaded."
              retry={() => catalog.refetch()}
              isRetrying={catalog.isRefetching}
            />
          ) : (
            <>
              <p className="text-meta text-muted-foreground" aria-live="polite">
                {total.toLocaleString()} {total === 1 ? "model" : "models"}
                {" · "}
                {enabled.length.toLocaleString()} enabled
              </p>
              {models.length === 0 ? (
                <p className="text-muted-foreground text-body">
                  No matching models.
                </p>
              ) : (
                <ul
                  aria-label={`${providerName} models`}
                  className="rounded-surface flex min-w-0 flex-col divide-y border"
                >
                  {models.map((model) => (
                    <li key={model.id} className="min-w-0 px-3 py-2">
                      <Field orientation="horizontal" className="min-w-0">
                        <Checkbox
                          id={`setup-model-${model.id}`}
                          checked={model.id in selected}
                          onCheckedChange={(value) =>
                            toggle(model, value === true)
                          }
                        />
                        <FieldLabel
                          htmlFor={`setup-model-${model.id}`}
                          className="min-w-0 flex-1 wrap-anywhere"
                        >
                          {model.name}
                        </FieldLabel>
                        <CapabilityIcons model={model} />
                      </Field>
                    </li>
                  ))}
                </ul>
              )}
              {(previousCursors.length > 0 || catalog.data?.next_cursor) && (
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={previousCursors.length === 0}
                    onClick={() => {
                      setCursor(previousCursors.at(-1) ?? null);
                      setPreviousCursors((items) => items.slice(0, -1));
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
              )}
            </>
          )}
        </FieldSet>
        {defaultId && (
          <Field>
            <FieldLabel htmlFor="setup-default-model">Default model</FieldLabel>
            <Select
              value={defaultId}
              onValueChange={setChosenDefault}
              disabled={pending}
            >
              <SelectTrigger
                id="setup-default-model"
                className="w-full min-w-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {enabled.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              Your new chats start with this model.
            </FieldDescription>
          </Field>
        )}
        <Field>
          <Button type="submit" className={actionClassName} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {pending ? "Enabling models…" : "Continue"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={actionClassName}
            disabled={pending}
            onClick={onBack}
          >
            Change provider
          </Button>
          <SkipLink />
        </Field>
      </FieldGroup>
    </form>
  );
}
