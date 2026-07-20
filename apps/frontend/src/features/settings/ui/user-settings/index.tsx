import { Settings } from "@/features/settings/types/settings";
import { GeneralSettings } from "@/features/settings/ui/user-settings/general-settings";
import { Settings2Icon } from "lucide-react";

export const UserSettings: Settings = [
  {
    type: "section",
    label: "General",
    value: "general",
    isDefault: true,
    icon: <Settings2Icon />,
    settingsPane: <GeneralSettings />,
  },
];
