import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/features/auth/components/user-context";
import { useFeature } from "@/features/availability/queries";
import { chatgptConnectionOptions } from "@/features/chatgpt/queries";
import { skillsListOptions } from "@/features/skills/queries";
import { Types } from "@/features/settings/types";
import { AgentsSettings } from "@/features/settings/ui/user-settings/agents-settings";
import { GeneralSettings } from "@/features/settings/ui/user-settings/general-settings";
import { ChatGptConnectionSettings } from "@/features/chatgpt/components/chatgpt-connection-settings";
import { SkillsSettings } from "@/features/skills/components/skills-settings";
import { TemplatesSettings } from "@/features/templates/components/templates-settings";
import { RubricsSettings } from "@/features/templates/components/rubrics-settings";
import { YourAsterismSettings } from "./your-asterism-settings";
import {
  BotIcon,
  Settings2Icon,
  UserRoundIcon,
  BookOpenIcon,
  MessageCircleIcon,
  LayoutTemplateIcon,
  ClipboardCheckIcon,
} from "lucide-react";

/** Every User Settings section; `useUserSettingsSections` leaves some out. */
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
    label: "Your Asterism",
    value: "your-asterism",
    icon: <UserRoundIcon />,
    settingsPane: <YourAsterismSettings />,
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
    label: "Rubrics",
    value: "rubrics",
    icon: <ClipboardCheckIcon />,
    settingsPane: <RubricsSettings />,
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

/**
 * The sections this person sees (EPIC-97). A section whose feature the admin
 * has turned off is left out, unless the person has something saved there,
 * so they can still see and remove it.
 */
export function useUserSettingsSections(): Types {
  const user = useUser();
  const skills = useFeature("skills").available;
  const chatgpt = useFeature("chatgpt_plans").available;
  const savedSkills = useQuery({
    ...skillsListOptions(user.id, "", 1, 1),
    enabled: !skills,
  });
  const connection = useQuery({
    ...chatgptConnectionOptions(user.id),
    enabled: !chatgpt,
  });
  const shown: Record<string, boolean> = {
    skills: skills || (savedSkills.data?.total ?? 0) > 0,
    chatgpt: chatgpt || connection.data?.status != null,
  };
  return UserSettings.filter(
    (section) => section.type !== "section" || shown[section.value] !== false,
  );
}
