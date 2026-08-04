import { Types } from "@/features/settings/types";
import { CodeExecutionSettings } from "@/features/settings/ui/admin-settings/code-execution-settings";
import { ExportSettings } from "@/features/settings/ui/admin-settings/export-settings";
import { GroupSettings } from "@/features/settings/ui/admin-settings/groups-settings";
import { ImageGenSettings } from "@/features/settings/ui/admin-settings/image-gen-settings";
import { ProvidersTab } from "@/features/settings/ui/admin-settings/providers-tab";
import { ThemeEditor } from "@/features/settings/ui/admin-settings/theme-editor";
import { ToolsSettings } from "@/features/settings/ui/admin-settings/tools-settings";
import { UserPermissionsSettings } from "@/features/settings/ui/admin-settings/user-permissions-settings";
import { WebSearchSettings } from "@/features/settings/ui/admin-settings/web-search";
import {
  IconCloudCog,
  IconCloudSearch,
  IconDatabaseExport,
  IconImageGeneration,
  IconUsersGroup,
  IconUserShield,
} from "@tabler/icons-react";
import { CodeIcon, PaletteIcon, ToolboxIcon } from "lucide-react";

export const AdminSettings: Types = [
  {
    type: "section",
    label: "Providers",
    value: "providers",
    isDefault: true,
    icon: <IconCloudCog />,
    settingsPane: <ProvidersTab />,
  },
  {
    type: "section",
    label: "Theme Editor",
    value: "theme_editor",
    icon: <PaletteIcon />,
    settingsPane: <ThemeEditor />,
  },
  { type: "separator" },
  {
    type: "section",
    label: "Groups",
    value: "group-settings",
    icon: <IconUsersGroup />,
    settingsPane: <GroupSettings />,
  },
  {
    type: "section",
    label: "Users",
    value: "user-permissions",
    icon: <IconUserShield />,
    settingsPane: <UserPermissionsSettings />,
  },
  { type: "separator" },
  {
    type: "section",
    label: "Web Search",
    value: "web-search",
    icon: <IconCloudSearch />,
    settingsPane: <WebSearchSettings />,
  },
  {
    type: "section",
    label: "Image Generation",
    value: "image-generation",
    icon: <IconImageGeneration />,
    settingsPane: <ImageGenSettings />,
  },
  {
    type: "section",
    label: "Tools",
    value: "tools",
    icon: <ToolboxIcon />,
    settingsPane: <ToolsSettings />,
  },
  {
    type: "section",
    label: "Code Exection",
    value: "code-exection",
    icon: <CodeIcon />,
    settingsPane: <CodeExecutionSettings />,
  },
  { type: "separator" },
  {
    type: "section",
    label: "Export",
    value: "export",
    icon: <IconDatabaseExport />,
    settingsPane: <ExportSettings />,
  },
];
