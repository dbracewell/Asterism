import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Types } from "@/features/settings/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
  const defaultSection = settings
    .filter((setting) => setting.type === "section")
    .find((setting) => setting.isDefault)?.value;
  const requestedSection = settings.some(
    (setting) => setting.type === "section" && setting.value === defaultTab,
  )
    ? defaultTab
    : defaultSection;
  const [activeSection, setActiveSection] = useState(requestedSection);

  useEffect(() => {
    setActiveSection(requestedSection);
  }, [requestedSection]);

  const selectedSetting = settings.find(
    (setting) =>
      setting.type === "section" && setting.value === activeSection,
  );

  return (
    <Tabs
      orientation={isMobile ? "horizontal" : "vertical"}
      value={activeSection}
      onValueChange={(value) => {
        setActiveSection(value);
        router.replace(`${pathname}?t=${name}&setting=${value}`);
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
      {selectedSetting?.type === "section" && (
        <TabsContent
          key={selectedSetting.value}
          value={selectedSetting.value}
          className="flex max-h-full min-h-0 flex-1 flex-col p-2"
        >
          {selectedSetting.settingsPane}
        </TabsContent>
      )}
    </Tabs>
  );
};
