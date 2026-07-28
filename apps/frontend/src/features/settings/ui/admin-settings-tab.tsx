import { TabsContent } from "@/components/ui/tabs";
import { AdminSettings } from "@/features/settings/ui/admin-settings";
import { SettingsCard } from "@/features/settings/ui/setttings-card";

export const AdminSettingsTab = () => {
  return (
    <TabsContent value="admin" className="flex min-h-0 flex-1">
      <SettingsCard settings={AdminSettings} />
    </TabsContent>
  );
};
