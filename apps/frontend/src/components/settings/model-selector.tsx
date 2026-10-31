"use client";

import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import {
  CapabilityIcons,
  capabilityLabels,
  modelLabel,
  PROVIDER_TYPES,
  ProviderIcon,
} from "@/components/settings/model-identity";
import type { ChatModelChoice, LlmDisplayInfo } from "@/lib/client";
import { cn } from "@/lib/utils";
import { useId, useRef, useState } from "react";

export type ModelOption = LlmDisplayInfo | ChatModelChoice;

type ModelSelectorProps = {
  id?: string;
  value?: string;
  onValueChange: (model: string) => void;
  availableModels?: ModelOption[];
  className?: string;
  align?: "center" | "start" | "end" | undefined;
  disabled?: boolean;
  /** `inline` is a borderless pill for toolbars such as the chat composer. */
  variant?: "field" | "inline";
  /** Append the provider name to each model. */
  showProvider?: boolean;
  /** Show supported-capability icons on each listed model. */
  showCapabilities?: boolean;
  /** Label for a saved value that is no longer selectable. */
  savedLabel?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
};

const isAvailable = (model: ModelOption) =>
  !("available" in model) || model.available;

const matches = (model: ModelOption, query: string) =>
  `${modelLabel(model)} ${model.name} ${model.provider_name}`
    .toLowerCase()
    .includes(query.trim().toLowerCase());

const ModelLabel = ({
  model,
  showProvider,
}: {
  model: ModelOption;
  showProvider: boolean;
}) => (
  <span className="flex min-w-0 items-center gap-1.5">
    {model.provider_type && (
      <ProviderIcon
        type={model.provider_type}
        className="text-muted-foreground"
      />
    )}
    <span className="truncate">
      {modelLabel(model)}{" "}
      {showProvider && (
        <span className="text-muted-foreground">({model.provider_name})</span>
      )}
    </span>
  </span>
);

/**
 * Icons stay out of the option's accessible name so it remains the model
 * label; the same identity is read as the option's description instead.
 */
const ModelOptionItem = ({
  model,
  showProvider,
  showCapabilities,
}: {
  model: ModelOption;
  showProvider: boolean;
  showCapabilities: boolean;
}) => {
  const descriptionId = useId();
  const description = [
    model.provider_type &&
      `${PROVIDER_TYPES[model.provider_type].label} provider`,
    ...(showCapabilities ? capabilityLabels(model) : []),
  ]
    .filter(Boolean)
    .join(". ");
  return (
    <ComboboxItem
      value={model}
      className="pr-7"
      aria-describedby={description ? descriptionId : undefined}
    >
      <ModelLabel model={model} showProvider={showProvider} />
      {showCapabilities && (
        <CapabilityIcons model={model} decorative className="ml-auto" />
      )}
      {description && (
        <span id={descriptionId} hidden>
          {description}
        </span>
      )}
    </ComboboxItem>
  );
};

/**
 * Searchable model picker. Unavailable models are never listed; a saved value
 * that is no longer selectable stays visible, marked unavailable, until the
 * user explicitly picks another model.
 */
export const ModelSelector = ({
  id,
  value,
  onValueChange,
  availableModels,
  className,
  align = "start",
  disabled = false,
  variant = "field",
  showProvider = false,
  showCapabilities = false,
  savedLabel,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
}: ModelSelectorProps) => {
  const trigger = useRef<HTMLButtonElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const selectable = (availableModels ?? []).filter(isAvailable);
  const selected = selectable.find((model) => model.id === value) ?? null;
  const known = availableModels?.find((model) => model.id === value);
  const inline = variant === "inline";

  return (
    <Combobox
      onOpenChange={(open) => {
        if (open) {
          // Keep the popup inside a modal's focus/pointer boundary and stacking
          // context. A body portal competes with the Radix dialog's focus trap.
          setPortalContainer(
            trigger.current?.closest<HTMLElement>('[role="dialog"]') ?? null,
          );
        }
      }}
      items={selectable}
      value={selected}
      onValueChange={(model: ModelOption | null) => {
        if (model) onValueChange(model.id);
      }}
      itemToStringLabel={(model: ModelOption) => modelLabel(model)}
      itemToStringValue={(model: ModelOption) => model.id}
      isItemEqualToValue={(a: ModelOption, b: ModelOption) => a.id === b.id}
      filter={matches}
      disabled={disabled}
    >
      <ComboboxTrigger
        ref={trigger}
        id={id}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        render={
          <Button
            type="button"
            variant={inline ? "ghost" : "outline"}
            className={cn(
              "rounded-control min-w-0 justify-between gap-1.5 font-normal",
              inline
                ? "data-popup-open:bg-muted h-8 max-w-full px-3 font-medium"
                : "w-full",
              className,
            )}
          />
        }
      >
        <span className="min-w-0 truncate text-left">
          {selected ? (
            <ModelLabel model={selected} showProvider={showProvider} />
          ) : value ? (
            `${savedLabel ?? (known ? modelLabel(known) : value)} (unavailable)`
          ) : (
            <span className="text-muted-foreground">Select a model...</span>
          )}
        </span>
      </ComboboxTrigger>
      <ComboboxContent
        portalContainer={portalContainer}
        collisionBoundary={portalContainer ?? undefined}
        side={inline ? "top" : "bottom"}
        align={align === "center" ? "center" : align}
        className="w-80 max-w-[calc(100vw-2rem)]"
      >
        <ComboboxInput
          showTrigger={false}
          placeholder="Search models…"
          className="has-[[data-slot=input-group-control]:focus-visible]:ring-0"
        />
        <ComboboxEmpty>No models found.</ComboboxEmpty>
        <ComboboxList>
          {(model: ModelOption) => (
            <ModelOptionItem
              key={model.id}
              model={model}
              showProvider={showProvider}
              showCapabilities={showCapabilities}
            />
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
};
