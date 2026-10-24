import { Types } from "@/features/settings/types";
import { AgentsSettings } from "@/features/settings/ui/user-settings/agents-settings";
import { GeneralSettings } from "@/features/settings/ui/user-settings/general-settings";
import { PersonaSettings } from "./persona-settings";
import { BotIcon, Settings2Icon, UserRoundIcon } from "lucide-react";

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
    label: "Agents",
    value: "agents",
    icon: <BotIcon />,
    settingsPane: <AgentsSettings />,
  },
];
