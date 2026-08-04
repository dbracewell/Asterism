import { TabsContent } from "@/components/ui/tabs";
import { SettingsCard } from "@/features/settings/ui/setttings-card";
import { UserSettings } from "@/features/settings/ui/user-settings";
export const UserSettingsTab = () => {
  return (
    <TabsContent value="user">
      <SettingsCard settings={UserSettings} />
    </TabsContent>
  );
};
