"use client";

import type { Types } from "@/features/settings/types";
import {
  AdminPaneErrorBoundary,
  AdminPaneLoading,
} from "@/features/settings/ui/admin-settings/admin-pane-state";
import type { ApplicationSettings } from "@/lib/client";
import {
  IconCloudCog,
  IconDatabaseExport,
  IconImageGeneration,
  IconPhoto,
  IconUsersGroup,
  IconUserShield,
} from "@tabler/icons-react";
import { CodeIcon, PaletteIcon, ToolboxIcon } from "lucide-react";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";

const ProvidersTab = dynamic(
  () =>
    import("@/features/settings/ui/admin-settings/providers-tab").then(
      (module) => module.ProvidersTab,
    ),
  { loading: AdminPaneLoading },
);
const ThemeEditor = dynamic(
  () =>
    import("@/features/settings/ui/admin-settings/theme-editor").then(
      (module) => module.ThemeEditor,
    ),
  { loading: AdminPaneLoading },
);
const GroupSettings = dynamic(
  () =>
    import("@/features/settings/ui/admin-settings/groups-settings").then(
      (module) => module.GroupSettings,
    ),
  { loading: AdminPaneLoading },
);
const UserPermissionsSettings = dynamic(
  () =>
    import(
      "@/features/settings/ui/admin-settings/user-permissions-settings"
    ).then((module) => module.UserPermissionsSettings),
  { loading: AdminPaneLoading },
);
const ToolsSettings = dynamic(
  () =>
    import("@/features/settings/ui/admin-settings/tools-settings").then(
      (module) => module.ToolsSettings,
    ),
  { loading: AdminPaneLoading },
);
const ImageGenSettings = dynamic(
  () =>
    import("@/features/settings/ui/admin-settings/image-gen-settings").then(
      (module) => module.ImageGenSettings,
    ),
  { loading: AdminPaneLoading },
);
const CaptioningSettings = dynamic(
  () =>
    import("@/features/settings/ui/admin-settings/captioning-settings").then(
      (module) => module.CaptioningSettings,
    ),
  { loading: AdminPaneLoading },
);
const CodeExecutionSettings = dynamic(
  () =>
    import(
      "@/features/settings/ui/admin-settings/code-execution-settings"
    ).then((module) => module.CodeExecutionSettings),
  { loading: AdminPaneLoading },
);
const ExportSettings = dynamic(
  () =>
    import("@/features/settings/ui/admin-settings/export-settings").then(
      (module) => module.ExportSettings,
    ),
  { loading: AdminPaneLoading },
);

const pane = (paneLabel: string, children: ReactNode) => (
  <AdminPaneErrorBoundary paneLabel={paneLabel}>
    {children}
  </AdminPaneErrorBoundary>
);

export const getLazyAdminSettingsSections = (
  appSettings: ApplicationSettings,
): Types => [
  {
    type: "section",
    label: "Providers",
    value: "providers",
    isDefault: true,
    icon: <IconCloudCog />,
    settingsPane: pane(
      "Providers",
      <ProvidersTab appSettings={appSettings} />,
    ),
  },
  {
    type: "section",
    label: "Theme Editor",
    value: "theme_editor",
    icon: <PaletteIcon />,
    settingsPane: pane("Theme Editor", <ThemeEditor />),
  },
  { type: "separator" },
  {
    type: "section",
    label: "Groups",
    value: "group-settings",
    icon: <IconUsersGroup />,
    settingsPane: pane("Groups", <GroupSettings />),
  },
  {
    type: "section",
    label: "Users",
    value: "user-permissions",
    icon: <IconUserShield />,
    settingsPane: pane("Users", <UserPermissionsSettings />),
  },
  { type: "separator" },
  {
    type: "section",
    label: "Tools",
    value: "tools",
    icon: <ToolboxIcon />,
    settingsPane: pane(
      "Tools",
      <ToolsSettings appSettings={appSettings} />,
    ),
  },
  {
    type: "section",
    label: "Image Generation",
    value: "image-generation",
    icon: <IconImageGeneration />,
    settingsPane: pane("Image Generation", <ImageGenSettings />),
  },
  {
    type: "section",
    label: "Image Captioning",
    value: "image-captioning",
    icon: <IconPhoto />,
    settingsPane: pane(
      "Image Captioning",
      <CaptioningSettings appSettings={appSettings} />,
    ),
  },
  {
    type: "section",
    label: "Code Exection",
    value: "code-exection",
    icon: <CodeIcon />,
    settingsPane: pane("Code Exection", <CodeExecutionSettings />),
  },
  { type: "separator" },
  {
    type: "section",
    label: "Export",
    value: "export",
    icon: <IconDatabaseExport />,
    settingsPane: pane("Export", <ExportSettings />),
  },
];
