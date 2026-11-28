"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProviderServiceInfo } from "@/lib/client";
import {
  dockerHostUrl,
  OPENAI_LABEL,
  SERVICE_GROUPS,
  type ServiceChoice,
} from "../provider-services";

/**
 * One dropdown for how a provider connects (ADR-0086): OpenAI, a service from
 * the catalog, grouped as hosted APIs, aggregators and local servers, or Custom.
 * The catalog may still be loading; OpenAI and Custom are always offered.
 */
export function ServiceSelect({
  id,
  value,
  onChange,
  catalog,
  disabled,
  ariaLabel,
}: {
  id: string;
  value: ServiceChoice;
  onChange: (choice: ServiceChoice) => void;
  catalog: readonly ProviderServiceInfo[] | undefined;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as ServiceChoice)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="openai">{OPENAI_LABEL}</SelectItem>
        </SelectGroup>
        {SERVICE_GROUPS.map(({ group, label }) => {
          const entries = (catalog ?? []).filter(
            (entry) => entry.group === group,
          );
          if (entries.length === 0) return null;
          return (
            <SelectGroup key={group}>
              <SelectSeparator />
              <SelectLabel>{label}</SelectLabel>
              {entries.map((entry) => (
                <SelectItem key={entry.service} value={entry.service}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectGroup>
          );
        })}
        <SelectGroup>
          <SelectSeparator />
          <SelectItem value="custom">Custom OpenAI-compatible URL</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/**
 * Under a local server's URL: in Docker, ``localhost`` is the container, so a
 * server on the host is reached at ``host.docker.internal``.
 */
export function LocalServerNote({
  id,
  baseUrl,
}: {
  id: string;
  baseUrl: string;
}) {
  const suggestion = dockerHostUrl(baseUrl);
  return (
    <p id={id} className="text-muted-foreground text-sm">
      If Asterism runs in Docker, <code>localhost</code> is the container
      itself.
      {suggestion ? (
        <>
          {" "}
          To reach a server on this computer, use <code>{suggestion}</code>.
        </>
      ) : (
        <> Use the host&apos;s address, such as host.docker.internal.</>
      )}
    </p>
  );
}
