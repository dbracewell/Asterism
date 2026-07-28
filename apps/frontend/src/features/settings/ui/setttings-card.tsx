import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Types } from "@/features/settings/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export const SettingsCard = ({ settings }: { settings: Types }) => {
  const isMobile = useIsMobile();
  return (
    <Tabs
      orientation="vertical"
      defaultValue={
        settings.filter((s) => s.type === "section").find((s) => s.isDefault)
          ?.value
      }
      className="bg-card flex min-h-0 flex-1 gap-0! rounded-md border text-base!"
    >
      <TabsList
        className={cn("min-w-50 bg-transparent", isMobile && "w-9 min-w-9")}
      >
        {settings.map((setting, i) => {
          if (setting.type === "section") {
            return (
              <TabsTrigger
                key={setting.value}
                value={setting.value}
                className="flex items-center justify-center truncate text-base!"
              >
                {setting.icon}
                <span className={cn("truncate", isMobile && "hidden")}>
                  {setting.label}
                </span>
              </TabsTrigger>
            );
          }
          return <Separator key={i} className="my-2" />;
        })}
      </TabsList>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-l px-4 py-1">
        {settings
          .filter((s) => s.type === "section")
          .map((setting) => (
            <TabsContent
              key={setting.value}
              value={setting.value}
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-base!"
            >
              {setting.settingsPane}
            </TabsContent>
          ))}
      </div>
    </Tabs>
  );
};
