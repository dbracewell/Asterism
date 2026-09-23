"use client";
import { Spinner } from "@/components/ui/spinner";
import { TabsContent } from "@/components/ui/tabs";
import { getAdminSettingsSections } from "@/features/settings/ui/admin-settings";
import { adminSettingsQueryOptions } from "@/features/settings/ui/admin-settings-query";
import { SettingsCard } from "@/features/settings/ui/setttings-card";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export const AdminSettingsTab = ({ defaultTab }: { defaultTab?: string }) => {
  const { data, isLoading, error } = useQuery(adminSettingsQueryOptions());

  const adminSettingsSections = useMemo(
    () => (data ? getAdminSettingsSections(data) : []),
    [data],
  );

  if (isLoading) {
    return <Spinner />;
  }

  if (error || data == null) {
    return (
      <TabsContent value="admin" className="min-h-0 overflow-hidden">
        <p role="alert" className="text-destructive">
          Admin settings could not be loaded.
        </p>
      </TabsContent>
    );
  }

  return (
    <TabsContent value="admin" className="min-h-0 overflow-hidden">
      <SettingsCard
        settings={adminSettingsSections}
        defaultTab={defaultTab}
        name="admin"
      />
    </TabsContent>
  );
};
