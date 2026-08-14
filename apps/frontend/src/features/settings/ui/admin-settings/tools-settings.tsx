import { ComponentSettings } from "@/features/settings/ui/admin-settings/component-settings";
import { ApplicationSettings } from "@/lib/client";
import { useMemo } from "react";

export const ToolsSettings = ({
  appSettings,
}: {
  appSettings: ApplicationSettings;
}) => {
  const components = useMemo(
    () => [
      {
        type: "WebSearch",
        settings_key: "web_search_provider",
        title: "Web Search",
        default_value: appSettings.web_search_provider,
      },
      {
        type: "ImageSearch",
        settings_key: "image_search_provider",
        title: "Image Search",
        default_value: appSettings.image_search_provider,
      },
    ],
    [appSettings],
  );

  return (
    <div className="flex h-full flex-1 flex-col gap-4">
      <div className="flex items-center gap-2 border-b pb-2">
        <h1 className="text-base font-bold">Tools</h1>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
        {components.map((cmp) => (
          <ComponentSettings
            key={cmp.settings_key}
            defaultValue={cmp.default_value}
            component_type={cmp.type}
            settings_key={cmp.settings_key}
            title={cmp.title}
          />
        ))}
      </div>
    </div>
  );
};
