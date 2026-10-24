import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Types } from "@/features/settings/types";
import { useReadWriteSearchParams } from "@/hooks/use-read-write-search-params";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

export const SettingsCard = ({
  name,
  settings,
  defaultTab,
}: {
  name: string;
  settings: Types;
  defaultTab?: string;
}) => {
  const { setSearchParams } = useReadWriteSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isNarrow, setIsNarrow] = useState(true);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      setIsNarrow(entry.contentRect.width < 640);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
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
    (setting) => setting.type === "section" && setting.value === activeSection,
  );

  return (
    <Tabs
      ref={containerRef}
      orientation={isNarrow ? "horizontal" : "vertical"}
      value={activeSection}
      onValueChange={(value) => {
        setActiveSection(value);
        setSearchParams({ t: name, setting: value });
      }}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1",
        isNarrow ? "flex-col" : "flex-row",
      )}
    >
      <TabsList
        className={cn(
          "max-h-full min-h-0 max-w-full shrink-0 justify-start rounded-none bg-transparent!",
          isNarrow
            ? "h-fit! w-full overflow-x-auto p-1"
            : "w-52 overflow-y-auto p-1",
        )}
      >
        <div
          className={cn(
            "bg-card flex flex-col items-center gap-0.5 rounded-md border p-2",
            isNarrow ? "flex-row" : "w-full",
          )}
        >
          {settings.map((setting, i) => {
            if (setting.type === "section") {
              return (
                <TabsTrigger
                  className={cn(
                    "flex-none",
                    isNarrow ? "" : "w-full justify-between gap-2",
                  )}
                  key={setting.value}
                  value={setting.value}
                  disabled={setting.disabled}
                  onFocus={(event) => {
                    event.currentTarget.scrollIntoView({
                      block: "nearest",
                      inline: "nearest",
                    });
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {setting.icon}
                    <span className="min-w-0 text-left wrap-anywhere whitespace-normal">
                      {setting.label}
                    </span>
                  </span>
                  {setting.badge && (
                    <Badge
                      variant="secondary"
                      className="ml-auto px-1.5 py-0 text-[10px] font-normal"
                    >
                      {setting.badge}
                    </Badge>
                  )}
                </TabsTrigger>
              );
            }
            return (
              <Separator
                key={i}
                orientation={isNarrow ? "vertical" : "horizontal"}
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
          className="flex max-h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-2"
        >
          {selectedSetting.settingsPane}
        </TabsContent>
      )}
    </Tabs>
  );
};
