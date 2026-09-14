import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ComponentRegistry } from "@/features/settings/types";
import { ComponentSettings } from "@/features/settings/ui/admin-settings/component-settings";
import { client } from "@/lib/api";
import { arraysEqual } from "@/lib/arrays";
import {
  ApplicationSettings,
  ComponentProviderParameters,
  ComponentType,
} from "@/lib/client";
import {
  appSettingsBulkUpdateMutation,
  toolsGetAllOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export const ToolsSettings = ({
  appSettings,
}: {
  appSettings: ApplicationSettings;
}) => {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [filterActive, setFilterActive] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const { data } = useQuery({
    ...toolsGetAllOptions({
      client,
    }),
  });
  const saveSettings = useMutation({
    ...appSettingsBulkUpdateMutation({
      client,
    }),
    onSuccess: () => {
      toast.success("Settings saved");
      router.refresh();
    },
    onError: () => toast.error("Failed to save. Please try again."),
  });

  const [toolSettings, setToolSettings] = useState(() => ({
    activeTools: appSettings.active_tools,
    components: {
      WebSearch: appSettings.web_search_provider ?? undefined,
      ImageGenerator: appSettings.image_search_provider ?? undefined,
    } as Record<ComponentType, ComponentProviderParameters>,
  }));

  useEffect(() => {
    setIsDirty(false);
    setToolSettings({
      activeTools: appSettings.active_tools,
      components: {
        WebSearch: appSettings.web_search_provider ?? undefined,
        ImageGenerator: appSettings.image_search_provider ?? undefined,
      } as Record<ComponentType, ComponentProviderParameters>,
    });
  }, [appSettings]);

  const tools = useMemo(() => {
    if (data == null) {
      return [];
    }
    if (!filter.trim() && !filterActive) {
      return data.items;
    }
    return data.items.filter(
      (tool) =>
        tool.name.toLowerCase().includes(filter.toLowerCase()) &&
        (!filterActive || toolSettings.activeTools.includes(tool.name)),
    );
  }, [filter, data, filterActive, toolSettings]);

  const components = useMemo(
    () =>
      ({
        WebSearch: {
          settings_key: "web_search_provider",
          title: "Web Search",
          default_value: appSettings.web_search_provider,
        },
        ImageSearch: {
          settings_key: "image_search_provider",
          title: "Image Search",
          default_value: appSettings.image_search_provider,
        },
      }) as ComponentRegistry,
    [appSettings],
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center gap-2 border-b pb-2">
        <h1 className="text-base font-bold">Tools</h1>
      </div>
      <div className="flex flex-col gap-x-4 gap-y-2 sm:flex-row sm:items-center">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tools..."
          className="max-w-100 flex-1"
        />
        <div className="flex items-center gap-1">
          <Checkbox
            name="active_tools"
            checked={filterActive}
            onCheckedChange={(e) => setFilterActive(!!e)}
          />
          <Label
            htmlFor="active_tools"
            className="text-muted-foreground text-sm font-medium"
          >
            Only Active Tools
          </Label>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
        {tools.map((tool) => {
          const cmp = tool.component_type
            ? components[tool.component_type]
            : null;
          return (
            <div
              key={tool.name}
              className="flex flex-col overflow-clip rounded border"
            >
              <div className="bg-accent text-accent-foreground flex items-center gap-2 p-2 text-sm font-bold">
                <Checkbox
                  name={tool.name}
                  checked={toolSettings.activeTools.includes(tool.name)}
                  onCheckedChange={(e) => {
                    if (!!e) {
                      setIsDirty(
                        !arraysEqual(appSettings.active_tools, [
                          ...toolSettings.activeTools,
                          tool.name,
                        ]),
                      );
                      setToolSettings((prev) => ({
                        ...prev,
                        activeTools: [
                          ...prev.activeTools.filter((t) => t !== tool.name),
                          tool.name,
                        ],
                      }));
                    } else {
                      setIsDirty(
                        !arraysEqual(
                          appSettings.active_tools,
                          toolSettings.activeTools.filter(
                            (t) => t !== tool.name,
                          ),
                        ),
                      );
                      setToolSettings((prev) => ({
                        ...prev,
                        activeTools: prev.activeTools.filter(
                          (t) => t !== tool.name,
                        ),
                      }));
                    }
                  }}
                />
                <Label htmlFor={tool.name}>{tool.name}</Label>
              </div>
              <p className="text-muted-foreground px-2 py-1 text-xs">
                {tool.description}
              </p>
              {tool.component_type && cmp && (
                <ComponentSettings
                  className="p-2"
                  key={cmp.settings_key}
                  defaultValue={cmp.default_value}
                  component_type={tool.component_type}
                  settings_key={cmp.settings_key}
                  onUpdate={({ name, parameters }) => {
                    setIsDirty(true);
                    setToolSettings((prev) => ({
                      ...prev,
                      components: {
                        ...prev.components,
                        [tool.component_type!]: {
                          name,
                          parameters,
                        },
                      },
                    }));
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-end">
        <Button
          disabled={!isDirty || saveSettings.isPending}
          onClick={() => {
            saveSettings.mutate({
              body: {
                values: {
                  active_tools: toolSettings.activeTools,
                  web_search_provider: toolSettings.components.WebSearch,
                  image_search_provider: toolSettings.components.ImageSearch,
                },
              },
            });
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
};
