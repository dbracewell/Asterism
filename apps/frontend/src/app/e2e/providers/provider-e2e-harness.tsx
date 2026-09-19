"use client";

import { Spinner } from "@/components/ui/spinner";
import { ProvidersTab } from "@/features/settings/ui/admin-settings/providers-tab";
import { client } from "@/lib/api";
import { appSettingsGetOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";

export function ProviderE2EHarness() {
  const { data, isLoading, error } = useQuery({
    ...appSettingsGetOptions({ client }),
  });

  if (isLoading) return <Spinner />;
  if (error || data == null) throw error;

  return (
    <main className="mx-auto flex h-screen max-w-5xl flex-col p-6">
      <ProvidersTab appSettings={data} />
    </main>
  );
}
