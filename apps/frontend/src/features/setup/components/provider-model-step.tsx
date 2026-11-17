"use client";

import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { CapabilityIcons } from "@/components/settings/model-identity";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { client } from "@/lib/api";
import type { Llm } from "@/lib/client";
import {
  appProviderModelsListOptions,
  appProviderModelUpdateMutation,
  appProviderSettingsGetOptions,
  appProviderSettingsUpdateMutation,
  userSettingUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Loader2, XIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";
import {
  actionClassName,
  errorSuffix,
  useErrorSummary,
  ErrorSummary,
  SkipLink,
} from "./provider-setup-shared";
import { savedApiKey } from "./provider-connect-step";

const PAGE_SIZE = 20;

type Capability = "vision" | "tools";
type CapabilityChoices = Partial<Record<Capability, boolean>>;

const CAPABILITIES: { key: Capability; label: string }[] = [
  { key: "vision", label: "Vision" },
  { key: "tools", label: "Tools" },
];

const discovered = (model: Llm, capability: Capability) =>
  capability === "vision" ? model.supports_vision : model.supports_tools;

/** Whether a capability box is checked: the administrator's choice, else discovery. */
export const capabilityChecked = (
  model: Llm,
  choices: CapabilityChoices | undefined,
  capability: Capability,
) => choices?.[capability] ?? discovered(model, capability) === true;

/**
 * One capability's saved value and source. A box the administrator changed is
 * a manual value; an untouched one keeps its discovered value and source, so
 * an unknown capability left unchecked stays unknown (EPIC-62).
 */
export function capabilityUpdate(
  model: Llm,
  choices: CapabilityChoices | undefined,
  capability: Capability,
): { value: boolean | null; source: Llm["vision_source"] } {
  const value = discovered(model, capability) ?? null;
  const source =
    capability === "vision" ? model.vision_source : model.tools_source;
  const checked = capabilityChecked(model, choices, capability);
  return checked === (value === true)
    ? { value, source }
    : { value: checked, source: "manual" };
}

export function ModelStep({
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
  const [chosenDraft, setChosenDraft] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<
    Record<string, CapabilityChoices>
  >({});
  const enabled = Object.values(selected);
  const defaultId =
    chosenDefault && selected[chosenDefault]
      ? chosenDefault
      : (enabled[0]?.id ?? null);
  // The draft model follows the default until chosen, and falls back to the
  // default if the chosen model is disabled again.
  const draftId =
    chosenDraft && selected[chosenDraft] ? chosenDraft : defaultId;
  const queryClient = useQueryClient();
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
  const saveProviders = useMutation({
    ...appProviderSettingsUpdateMutation({ client }),
    meta,
  });
  const pending =
    updateModel.isPending || updateSetting.isPending || saveProviders.isPending;

  /** Save the draft model, re-sending the current providers unchanged. */
  const saveDraftModel = async (modelId: string) => {
    // The draft must reference an active model, so this runs after enabling.
    const current = await queryClient.fetchQuery({
      ...appProviderSettingsGetOptions({ client }),
      staleTime: 0,
    });
    await saveProviders.mutateAsync({
      body: {
        llm_providers: (current.llm_providers ?? []).map((provider) => ({
          ...provider,
          api_key: savedApiKey(provider),
        })),
        draft_model_id: modelId,
      },
    });
  };

  const toggle = (model: Llm, on: boolean) => {
    setSelected((current) => {
      const next = { ...current };
      if (on) next[model.id] = model;
      else delete next[model.id];
      return next;
    });
    // Re-enabling a model starts again from the discovered values.
    if (!on)
      setCapabilities((current) => {
        const next = { ...current };
        delete next[model.id];
        return next;
      });
  };

  const choose = (model: Llm, capability: Capability, checked: boolean) =>
    setCapabilities((current) => ({
      ...current,
      [model.id]: { ...current[model.id], [capability]: checked },
    }));

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
        const vision = capabilityUpdate(
          model,
          capabilities[model.id],
          "vision",
        );
        const tools = capabilityUpdate(model, capabilities[model.id], "tools");
        await updateModel.mutateAsync({
          path: { provider_id: providerId, model_id: model.id },
          body: {
            is_active: true,
            context_window: model.context_window ?? null,
            supports_vision: vision.value,
            supports_tools: tools.value,
            tools_source: tools.source,
            context_window_source: model.context_window_source,
            vision_source: vision.source,
          },
        });
      }
      await updateSetting.mutateAsync({
        path: { key: "default_model_id" },
        body: { value: defaultId },
      });
      await saveDraftModel(draftId ?? defaultId);
    } catch (cause) {
      showError(
        `Your model choices could not be saved.${errorSuffix(cause)} Your choices are kept; retry Continue.`,
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
              {enabled.length > 0 && (
                <FieldDescription>
                  Check Vision and Tools only for what each enabled model
                  supports; unchecked capabilities are not used. Tools are
                  needed for sub-agents and project file search.
                </FieldDescription>
              )}
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
                      {model.id in selected && (
                        <CapabilityChoicesRow
                          model={model}
                          choices={capabilities[model.id]}
                          onChange={(capability, checked) =>
                            choose(model, capability, checked)
                          }
                        />
                      )}
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
        {draftId && (
          <Field>
            <FieldLabel htmlFor="setup-draft-model">Draft model</FieldLabel>
            <Select
              value={draftId}
              onValueChange={setChosenDraft}
              disabled={pending}
            >
              <SelectTrigger
                id="setup-draft-model"
                className="w-full min-w-0"
                aria-describedby="setup-draft-model-description"
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
            <FieldDescription id="setup-draft-model-description">
              Writes chat titles and other short background tasks for everyone.
              A small, fast model works best.
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

/** Vision and Tools boxes for one enabled model, marking values discovery left unknown. */
function CapabilityChoicesRow({
  model,
  choices,
  onChange,
}: {
  model: Llm;
  choices: CapabilityChoices | undefined;
  onChange: (capability: Capability, checked: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 pl-6">
      {CAPABILITIES.map(({ key, label }) => {
        const id = `setup-model-${model.id}-${key}`;
        const unknown =
          discovered(model, key) == null && choices?.[key] === undefined;
        return (
          <Field key={key} orientation="horizontal" className="w-auto">
            <Checkbox
              id={id}
              aria-label={`${label} for ${model.name}`}
              aria-describedby={unknown ? `${id}-unknown` : undefined}
              checked={capabilityChecked(model, choices, key)}
              onCheckedChange={(value) => onChange(key, value === true)}
            />
            <FieldLabel htmlFor={id} className="text-meta font-normal">
              {label}
              {unknown && (
                <span id={`${id}-unknown`} className="text-muted-foreground">
                  (Unknown)
                </span>
              )}
            </FieldLabel>
          </Field>
        );
      })}
    </div>
  );
}
