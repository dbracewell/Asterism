import { Types } from "@/features/settings/types";
import { GeneralSettings } from "@/features/settings/ui/user-settings/general-settings";
import { PaletteIcon, Settings2Icon } from "lucide-react";
import { AppearanceSettings } from "@/features/settings/ui/user-settings/appearance-settings";

export const UserSettings: Types = [
  {
    type: "section",
    label: "Appearance",
    value: "appearance",
    isDefault: true,
    icon: <PaletteIcon />,
    settingsPane: <AppearanceSettings />,
  },
  {
    type: "section",
    label: "General",
    value: "general",
    icon: <Settings2Icon />,
    settingsPane: <GeneralSettings />,
  },
];
