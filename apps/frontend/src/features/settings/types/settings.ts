export type SettingsSection = {
  type: "section";
  label: string;
  value: string;
  isDefault?: boolean;
  icon: React.ReactNode;
  settingsPane: React.ReactNode;
};

export type SeparatorSection = {
  type: "separator";
};

type SettingsItem = SeparatorSection | SettingsSection;

export type Settings = SettingsItem[];
