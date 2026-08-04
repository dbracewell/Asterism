import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Types } from "@/features/settings/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export const SettingsCard = ({ settings }: { settings: Types }) => {
  const isMobile = useIsMobile();
  return (
    <Tabs
      orientation={isMobile ? "horizontal" : "vertical"}
      defaultValue={
        settings.filter((s) => s.type === "section").find((s) => s.isDefault)
          ?.value
      }
      className={"flex h-full min-h-0 flex-1 overflow-clip"}
    >
      <TabsList
        className={cn(
          "rounded-none bg-transparent!",
          isMobile ? "h-fit! max-w-full" : "w-40",
        )}
      >
        <div
          className={cn(
            "bg-card flex flex-col items-center gap-0.5 overflow-x-auto overflow-y-hidden rounded-md border p-2",
            isMobile ? "flex-row" : "w-full",
          )}
        >
          {settings.map((setting, i) => {
            if (setting.type === "section") {
              return (
                <TabsTrigger key={setting.value} value={setting.value}>
                  {setting.icon}
                  <span>{setting.label}</span>
                </TabsTrigger>
              );
            }
            return (
              <Separator
                key={i}
                orientation={isMobile ? "vertical" : "horizontal"}
                className="my-2"
              />
            );
          })}
        </div>
      </TabsList>
      {settings
        .filter((s) => s.type === "section")
        .map((setting) => (
          <TabsContent
            key={setting.value}
            value={setting.value}
            className="flex max-h-full min-h-0 flex-1 flex-col p-2"
          >
            {setting.settingsPane}
          </TabsContent>
        ))}
    </Tabs>
  );
};
