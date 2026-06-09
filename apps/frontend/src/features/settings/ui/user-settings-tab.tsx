import { ThemeSelector } from "@/components/settings/theme-selector";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IconPaint } from "@tabler/icons-react";
import { SettingsIcon } from "lucide-react";
//
//
export const UserSettingsTab = () => {
  return (
    <TabsContent value="user" className="flex flex-1 p-2">
      <Tabs
        orientation="vertical"
        defaultValue="appearance"
        className="bg-card flex min-h-0 flex-1 rounded-md border text-sm!"
      >
        <TabsList className="w-50 bg-transparent!">
          <TabsTrigger value="appearance" className="text-base!">
            <IconPaint /> Apperance
          </TabsTrigger>
          <TabsTrigger value="general" className="text-base!">
            <SettingsIcon /> General
          </TabsTrigger>
        </TabsList>
        <div className="flex min-h-0 flex-1 border-l px-4 py-2">
          <TabsContent value="appearance" className="space-y-4 text-base!">
            <div className="flex w-full items-center gap-10">
              <span className="font-medium">Theme:</span>
              <ThemeSelector />
            </div>
            <div className="flex w-full items-center gap-6">
              <span className="font-medium">Font Size:</span>
              Normal
            </div>
          </TabsContent>
          <TabsContent value="general">General</TabsContent>
        </div>
      </Tabs>
    </TabsContent>
  );
};
