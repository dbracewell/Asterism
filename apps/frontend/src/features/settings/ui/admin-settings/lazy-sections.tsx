"use client";

import type { Types } from "@/features/settings/types";
import {
  AdminPaneErrorBoundary,
  AdminPaneLoading,
} from "@/features/settings/ui/admin-settings/admin-pane-state";
import {
  BookOpenIcon,
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
const ChatGptPolicySettings = dynamic(
  () =>
    import("@/features/settings/ui/admin-settings/chatgpt-policy-settings").then(
      (module) => module.ChatGptPolicySettings,
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
    icon: <UsersRoundIcon />,
    badge: "Planned",
    settingsPane: pane("Groups", <GroupSettings />),
  },
  {
    type: "section",
    label: "Users",
    value: "user-permissions",
    icon: <ShieldUserIcon />,
    settingsPane: pane("Users", <UsersSettings />),
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
    label: "ChatGPT Plans",
    value: "chatgpt",
    icon: <MessageCircleIcon />,
    settingsPane: pane("ChatGPT Plans", <ChatGptPolicySettings />),
  },
  {
    type: "section",
    label: "Image Generation",
    value: "image-generation",
    icon: <ImagePlusIcon />,
    badge: "Planned",
    settingsPane: pane("Image Generation", <ImageGenSettings />),
  },
  {
    type: "section",
    label: "Image Captioning",
    value: "image-captioning",
    icon: <ImageIcon />,
    settingsPane: pane("Image Captioning", <CaptioningSettings />),
  },
  {
    type: "section",
    label: "Code Execution",
    value: "code-execution",
    icon: <CodeIcon />,
    badge: "Planned",
    settingsPane: pane("Code Execution", <CodeExecutionSettings />),
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
