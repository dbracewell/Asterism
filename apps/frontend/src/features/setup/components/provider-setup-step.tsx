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
  providerSchemaFor,
} from "@/features/settings/provider-schema";
import { client } from "@/lib/api";
import type { ProviderSettings } from "@/lib/client";
import {
  appProviderSettingsGetOptions,
  setupStepUpdateMutation,
  appProviderServicesListOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
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
import { setupHref } from "../walkthrough";

/**
 * Steps 2 and 3 of first-run setup: connect one provider, discover its models
 * and enable at least one, then confirm readiness. Rendered in the same card
 * as the account step.
 */
export function ProviderSetupStep({
  className,
  // A full load gives the new-chat page the saved default model.
  onStart = () => window.location.assign("/"),
  onContinueSetup,
}: {
  className?: string;
  onStart?: () => void;
  onContinueSetup?: () => void;
}) {
  const router = useRouter();
  const settings = useQuery(appProviderSettingsGetOptions({ client }));
  const [done, setDone] = useState(false);
  // These steps are the walkthrough's providers step. A failure here only
  // means the walkthrough offers that step again.
  const reviewed = useMutation({
    ...setupStepUpdateMutation({ client }),
    meta: { skipGlobalInvalidation: true },
  });
  const finish = () => {
    setDone(true);
    reviewed.mutate({
      path: { step_id: "providers" },
      body: { state: "done" },
    });
  };
  const [path, setPath] = useState<"provider" | "import" | "default-model">(
    "provider",
  );

  return (
    <div className={cn(authCardClassName, "max-w-lg", className)}>
      <FieldGroup>
        <AuthHeading description="Set up your Asterism instance" />
        <SetupSteps current={done ? 2 : 1} />
        {done ? (
          <ReadyStep
            onStart={onStart}
            // The walkthrough resumes at the first step not reviewed (US-101.2).
            onContinueSetup={
              onContinueSetup ?? (() => router.push(setupHref()))
            }
          />
        ) : path === "import" ? (
          <ImportStep
            onBack={() => setPath("provider")}
            onImported={() => setPath("default-model")}
          />
        ) : path === "default-model" ? (
          <DefaultModelStep
            onBack={() => setPath("provider")}
            onDone={finish}
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
            onDone={finish}
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
  const services = useQuery(appProviderServicesListOptions({ client }));
  const schema = useMemo(
    () => providerSchemaFor(services.data),
    [services.data],
  );
  const form = useForm<ProviderFormValues>({
    resolver: zodResolver(schema),
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
