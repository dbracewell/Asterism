"use client";

import { FormSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { FieldGroup } from "@/components/ui/field";
import {
  AuthHeading,
  authCardClassName,
  SetupSteps,
} from "@/features/auth/components/setup-steps";
import {
  type ProviderFormValues,
  providerSchema,
} from "@/features/settings/provider-schema";
import { client } from "@/lib/api";
import type { ProviderSettings } from "@/lib/client";
import { appProviderSettingsGetOptions } from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  ConnectStep,
  newProvider,
  savedProvider,
} from "./provider-connect-step";
import { ModelStep } from "./provider-model-step";
import { ImportStep } from "./setup-import-step";
import { DefaultModelStep } from "./setup-default-model-step";
import { ReadyStep } from "./setup-ready-step";

/**
 * Steps 2 and 3 of first-run setup: connect one provider, discover its models
 * and enable at least one, then confirm readiness. Rendered in the same card
 * as the account step.
 */
export function ProviderSetupStep({
  className,
  // A full load gives the new-chat page the saved default model.
  onStart = () => window.location.assign("/"),
}: {
  className?: string;
  onStart?: () => void;
}) {
  const settings = useQuery(appProviderSettingsGetOptions({ client }));
  const [done, setDone] = useState(false);
  const [path, setPath] = useState<"provider" | "import" | "default-model">(
    "provider",
  );

  return (
    <div className={cn(authCardClassName, "max-w-lg", className)}>
      <FieldGroup>
        <AuthHeading description="Set up your Asterism instance" />
        <SetupSteps current={done ? 2 : 1} />
        {done ? (
          <ReadyStep onStart={onStart} />
        ) : path === "import" ? (
          <ImportStep
            onBack={() => setPath("provider")}
            onImported={() => setPath("default-model")}
          />
        ) : path === "default-model" ? (
          <DefaultModelStep
            onBack={() => setPath("provider")}
            onDone={() => setDone(true)}
          />
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
            onDone={() => setDone(true)}
            onImport={() => setPath("import")}
          />
        )}
      </FieldGroup>
    </div>
  );
}

function ProviderSetupFlow({
  settings,
  onDone,
  onImport,
}: {
  settings: ProviderSettings;
  onDone: () => void;
  onImport: () => void;
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
    <ConnectStep
      form={form}
      settings={settings}
      onConnected={setConnected}
      onImport={onImport}
    />
  );
}
