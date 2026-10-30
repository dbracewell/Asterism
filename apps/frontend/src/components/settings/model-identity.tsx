import type { ProviderType } from "@/lib/client";
import { cn } from "@/lib/utils";
import {
  CloudIcon,
  ImageIcon,
  type LucideIcon,
  ServerIcon,
  WrenchIcon,
} from "lucide-react";

/**
 * Provider-type identity. Icons are monochrome lucide glyphs drawn with
 * `currentColor`, so they follow the surrounding text color in every theme.
 */
export const PROVIDER_TYPES: Record<
  ProviderType,
  { label: string; icon: LucideIcon }
> = {
  openai: { label: "OpenAI", icon: CloudIcon },
  generic_openai: { label: "OpenAI-compatible", icon: ServerIcon },
};

type CapabilityModel = {
  supports_tools?: boolean | null;
  supports_vision?: boolean | null;
};

type Capability = {
  key: keyof CapabilityModel;
  icon: LucideIcon;
  /** Short name shown as the icon's tooltip and accessible label. */
  name: string;
  labels: { true: string; false: string; unknown: string };
};

export const MODEL_CAPABILITIES: Capability[] = [
  {
    key: "supports_tools",
    icon: WrenchIcon,
    name: "Tool calling",
    labels: {
      true: "Tools supported",
      false: "Tools unsupported",
      unknown: "Tool support unknown",
    },
  },
  {
    key: "supports_vision",
    icon: ImageIcon,
    name: "Vision input",
    labels: {
      true: "Images supported",
      false: "Text only",
      unknown: "Image support unknown",
    },
  },
];

const stateOf = (value: boolean | null | undefined) =>
  value == null ? "unknown" : value ? "true" : "false";

/** One status sentence per capability, including unsupported and unknown. */
export const capabilityLabels = (model: CapabilityModel) =>
  MODEL_CAPABILITIES.map(
    (capability) => capability.labels[stateOf(model[capability.key])],
  );

/** Supported capabilities only; these are the ones drawn as icons. */
export const supportedCapabilities = (model: CapabilityModel) =>
  MODEL_CAPABILITIES.filter((capability) => model[capability.key] === true);

/**
 * Provider-type glyph with a native tooltip. Hidden from assistive technology
 * by default, for rows that name the type in text or a description; pass
 * `labelled` to expose it as a labelled image instead.
 */
export function ProviderIcon({
  type,
  labelled = false,
  className,
}: {
  type: ProviderType;
  labelled?: boolean;
  className?: string;
}) {
  const { icon: Icon, label } = PROVIDER_TYPES[type];
  return (
    <span
      role={labelled ? "img" : undefined}
      aria-label={labelled ? label : undefined}
      aria-hidden={labelled ? undefined : true}
      title={label}
      className="inline-flex shrink-0"
    >
      <Icon aria-hidden="true" className={cn("size-3.5", className)} />
    </span>
  );
}

/** Text label beside the provider glyph, for lists that name the type. */
export function ProviderTypeLabel({
  type,
  className,
}: {
  type: ProviderType;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-muted-foreground inline-flex items-center gap-1 text-xs",
        className,
      )}
    >
      <ProviderIcon type={type} />
      {PROVIDER_TYPES[type].label}
    </span>
  );
}

/**
 * Icons for the capabilities a model supports. Each icon carries a native
 * tooltip; it is a labelled image unless `decorative`, for rows that already
 * expose the same text another way (such as an option's description).
 */
export function CapabilityIcons({
  model,
  decorative = false,
  className,
}: {
  model: CapabilityModel;
  decorative?: boolean;
  className?: string;
}) {
  const supported = supportedCapabilities(model);
  if (supported.length === 0) return null;
  return (
    <span
      aria-hidden={decorative || undefined}
      className={cn(
        "text-muted-foreground inline-flex shrink-0 items-center gap-1",
        className,
      )}
    >
      {supported.map(({ key, icon: Icon, name }) => (
        <span
          key={key}
          role={decorative ? undefined : "img"}
          aria-label={decorative ? undefined : name}
          title={name}
          className="inline-flex"
        >
          <Icon aria-hidden="true" className="size-3.5" />
        </span>
      ))}
    </span>
  );
}
