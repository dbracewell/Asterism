import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Types } from "@/features/settings/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { usePathname, useRouter } from "next/navigation";

export const SettingsCard = ({
  name,
  settings,
  defaultTab,
}: {
  name: string;
  settings: Types;
  defaultTab?: string;
}) => {
  const isMobile = useIsMobile();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Tabs
      orientation={isMobile ? "horizontal" : "vertical"}
      defaultValue={
        defaultTab ??
        settings.filter((s) => s.type === "section").find((s) => s.isDefault)
          ?.value
      }
      onValueChange={(v) => {
        router.replace(`${pathname}?t=${name}&setting=${v}`);
      }}
      className={cn(
        "flex h-full min-h-0 flex-1 overflow-clip",
        isMobile ? "flex-col" : "flex-row",
      )}
    >
      <TabsList
        className={cn(
          "rounded-none bg-transparent!",
          isMobile ? "h-fit! max-w-full" : "w-40",
        )}
      >
        <div
          className={cn(
            "bg-card flex min-h-0 flex-col items-center gap-0.5 overflow-x-auto overflow-y-hidden rounded-md border p-2",
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
            className="hidden max-h-full min-h-0 flex-1 flex-col p-2 data-[state=active]:flex"
          >
            {setting.settingsPane}
          </TabsContent>
        ))}
    </Tabs>
  );
};
