import { TabsContent } from "@/components/ui/tabs";
import { SettingsCard } from "@/features/settings/ui/setttings-card";
import { UserSettings } from "@/features/settings/ui/user-settings";

export const UserSettingsTab = ({ defaultTab }: { defaultTab?: string }) => {
  return (
    <TabsContent value="user" className="min-h-0">
      <SettingsCard
        settings={UserSettings}
        defaultTab={defaultTab}
        name="user"
      />
    </TabsContent>
  );
};
