"use client";
import { TabsContent } from "@/components/ui/tabs";
import { getLazyAdminSettingsSections } from "@/features/settings/ui/admin-settings/lazy-sections";
import { SettingsCard } from "@/features/settings/ui/setttings-card";

export const AdminSettingsTab = ({ defaultTab }: { defaultTab?: string }) => {
  return (
    <TabsContent value="admin" className="min-h-0 overflow-hidden">
      <SettingsCard
        settings={getLazyAdminSettingsSections()}
        defaultTab={defaultTab}
        name="admin"
      />
    </TabsContent>
  );
};
