"use client";
import { Spinner } from "@/components/ui/spinner";
import { TabsContent } from "@/components/ui/tabs";
import { getAdminSettingsSections } from "@/features/settings/ui/admin-settings";
import { SettingsCard } from "@/features/settings/ui/setttings-card";
import { client } from "@/lib/api";
import { appSettingsGetOptions } from "@/lib/client/@tanstack/react-query.gen";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export const AdminSettingsTab = () => {
  const { data, isLoading, error } = useQuery({
    ...appSettingsGetOptions({
      client: client,
    }),
  });

  const adminSettingsSections = useMemo(
    () => (data ? getAdminSettingsSections(data) : []),
    [data],
  );

  if (isLoading) {
    return <Spinner />;
  }

  if (error || data == null) {
    throw error;
  }

  return (
    <TabsContent value="admin" className="overflow-hidden">
      <SettingsCard settings={adminSettingsSections} />
    </TabsContent>
  );
};
