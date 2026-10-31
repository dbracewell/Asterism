import { Types } from "@/features/settings/types";
import { AgentsSettings } from "@/features/settings/ui/user-settings/agents-settings";
import { GeneralSettings } from "@/features/settings/ui/user-settings/general-settings";
import { ChatGptConnectionSettings } from "@/features/chatgpt/components/chatgpt-connection-settings";
import { SkillsSettings } from "@/features/skills/components/skills-settings";
import { TemplatesSettings } from "@/features/templates/components/templates-settings";
import { PersonaSettings } from "./persona-settings";
import {
  BotIcon,
  Settings2Icon,
  UserRoundIcon,
  BookOpenIcon,
  MessageCircleIcon,
  LayoutTemplateIcon,
} from "lucide-react";

export const UserSettings: Types = [
  {
    type: "section",
    label: "General",
    value: "general",
    isDefault: true,
    icon: <Settings2Icon />,
    settingsPane: <GeneralSettings />,
  },
  {
    type: "section",
    label: "Personas",
    value: "personas",
    icon: <UserRoundIcon />,
    settingsPane: <PersonaSettings />,
  },
  {
    type: "section",
    label: "Skills",
    value: "skills",
    icon: <BookOpenIcon />,
    settingsPane: <SkillsSettings />,
  },
  {
    type: "section",
    label: "Templates",
    value: "templates",
    icon: <LayoutTemplateIcon />,
    settingsPane: <TemplatesSettings />,
  },
  {
    type: "section",
    label: "Agents",
    value: "agents",
    icon: <BotIcon />,
    settingsPane: <AgentsSettings />,
  },
  {
    type: "section",
    label: "ChatGPT",
    value: "chatgpt",
    icon: <MessageCircleIcon />,
    settingsPane: <ChatGptConnectionSettings />,
  },
];
