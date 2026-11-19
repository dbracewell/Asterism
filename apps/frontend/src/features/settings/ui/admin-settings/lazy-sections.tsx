"use client";

import type { Types } from "@/features/settings/types";
import {
  AdminPaneErrorBoundary,
  AdminPaneLoading,
} from "@/features/settings/ui/admin-settings/admin-pane-state";
import {
  BookOpenIcon,
  PanelRightIcon,
  CodeIcon,
  PaletteIcon,
  ToolboxIcon,
  CloudCogIcon,
  DatabaseBackupIcon,
  GraduationCapIcon,
  ImagePlusIcon,
  ImageIcon,
  UsersRoundIcon,
  ShieldUserIcon,
  MessageCircleIcon,
  ShrinkIcon,
  GaugeIcon,
  ActivityIcon,
} from "lucide-react";
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
const StatusSettings = dynamic(
  () =>
    import("@/features/settings/ui/admin-settings/status-settings").then(
      (module) => module.StatusSettings,
    ),
  { loading: AdminPaneLoading },
);
const UsageSettings = dynamic(
  () =>
    import("@/features/settings/ui/admin-settings/usage-settings").then(
      (module) => module.UsageSettings,
    ),
  { loading: AdminPaneLoading },
);
const UsersSettings = dynamic(
  () =>
    import("@/features/settings/ui/admin-settings/users-settings").then(
      (module) => module.UsersSettings,
    ),
  { loading: AdminPaneLoading },
);
const ToolsSettings = dynamic(
  () =>
    import("@/features/settings/ui/admin-settings/tools-settings").then(
      (module) => module.ToolsSettings,
    ),
  { loading: AdminPaneLoading },
);
const SkillsPolicySettings = dynamic(
  () =>
    import("@/features/settings/ui/admin-settings/skills-policy-settings").then(
      (module) => module.SkillsPolicySettings,
    ),
  { loading: AdminPaneLoading },
);
const CanvasPolicySettings = dynamic(
  () =>
    import("@/features/settings/ui/admin-settings/canvas-policy-settings").then(
      (module) => module.CanvasPolicySettings,
    ),
  { loading: AdminPaneLoading },
);
const ChatGptPolicySettings = dynamic(
  () =>
    import("@/features/settings/ui/admin-settings/chatgpt-policy-settings").then(
      (module) => module.ChatGptPolicySettings,
    ),
  { loading: AdminPaneLoading },
);
const CompactionSettingsPane = dynamic(
  () =>
    import("@/features/settings/ui/admin-settings/compaction-settings").then(
      (module) => module.CompactionSettingsPane,
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
    import("@/features/settings/ui/admin-settings/code-execution-settings").then(
      (module) => module.CodeExecutionSettings,
    ),
  { loading: AdminPaneLoading },
);
const EducatorSettings = dynamic(
  () =>
    import("@/features/settings/ui/admin-settings/educator-settings").then(
      (module) => module.EducatorSettings,
    ),
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

export const getLazyAdminSettingsSections = (): Types => [
  {
    type: "section",
    label: "Providers",
    value: "providers",
    isDefault: true,
    icon: <CloudCogIcon />,
    settingsPane: pane("Providers", <ProvidersTab />),
  },
  {
    type: "section",
    label: "Theme editor",
    value: "theme_editor",
    icon: <PaletteIcon />,
    settingsPane: pane("Theme editor", <ThemeEditor />),
  },
  { type: "separator" },
  {
    type: "section",
    label: "Groups",
    value: "group-settings",
    icon: <UsersRoundIcon />,
    settingsPane: pane("Groups", <GroupSettings />),
  },
  {
    type: "section",
    label: "Users",
    value: "user-permissions",
    icon: <ShieldUserIcon />,
    settingsPane: pane("Users", <UsersSettings />),
  },
  {
    type: "section",
    label: "Usage",
    value: "usage",
    icon: <GaugeIcon />,
    settingsPane: pane("Usage", <UsageSettings />),
  },
  {
    type: "section",
    label: "Status",
    value: "status",
    icon: <ActivityIcon />,
    settingsPane: pane("Status", <StatusSettings />),
  },
  { type: "separator" },
  {
    type: "section",
    label: "Tools",
    value: "tools",
    icon: <ToolboxIcon />,
    settingsPane: pane("Tools", <ToolsSettings />),
  },
  {
    type: "section",
    label: "Skills",
    value: "skills",
    icon: <BookOpenIcon />,
    settingsPane: pane("Skills", <SkillsPolicySettings />),
  },
  {
    type: "section",
    label: "Canvas",
    value: "canvas",
    icon: <PanelRightIcon />,
    settingsPane: pane("Canvas", <CanvasPolicySettings />),
  },
  {
    type: "section",
    label: "ChatGPT Plans",
    value: "chatgpt",
    icon: <MessageCircleIcon />,
    settingsPane: pane("ChatGPT Plans", <ChatGptPolicySettings />),
  },
  {
    type: "section",
    label: "Context compaction",
    value: "context-compaction",
    icon: <ShrinkIcon />,
    settingsPane: pane("Context compaction", <CompactionSettingsPane />),
  },
  {
    type: "section",
    label: "Image generation",
    value: "image-generation",
    icon: <ImagePlusIcon />,
    settingsPane: pane("Image generation", <ImageGenSettings />),
  },
  {
    type: "section",
    label: "Image captioning",
    value: "image-captioning",
    icon: <ImageIcon />,
    settingsPane: pane("Image captioning", <CaptioningSettings />),
  },
  {
    type: "section",
    label: "Code execution",
    value: "code-execution",
    icon: <CodeIcon />,
    badge: "Planned",
    settingsPane: pane("Code execution", <CodeExecutionSettings />),
  },
  { type: "separator" },
  {
    type: "section",
    label: "Educators",
    value: "educators",
    icon: <GraduationCapIcon />,
    settingsPane: pane("Educators", <EducatorSettings />),
  },
  {
    type: "section",
    label: "Export",
    value: "export",
    icon: <DatabaseBackupIcon />,
    settingsPane: pane("Export", <ExportSettings />),
  },
];
