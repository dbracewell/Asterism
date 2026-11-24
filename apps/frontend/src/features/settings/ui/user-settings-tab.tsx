import { TabsContent } from "@/components/ui/tabs";
import { SettingsCard } from "@/features/settings/ui/settings-card";
import { useUserSettingsSections } from "@/features/settings/ui/user-settings";

export const UserSettingsTab = ({ defaultTab }: { defaultTab?: string }) => {
  const sections = useUserSettingsSections();
  return (
    <TabsContent value="user" className="min-h-0 min-w-0">
      <SettingsCard settings={sections} defaultTab={defaultTab} name="user" />
    </TabsContent>
  );
};
