// Aggregated user settings returned from the backend
export interface UserSettings {
  theme: string;
  font_size: string;
  sidebar_collapsed: boolean;
}

// Single setting key-value response
export interface UserSettingResponse {
  key: string;
  value: Record<string, unknown>;
}

// Admin application settings
export interface ApplicationSettings {
  llm_providers: LLMProvider[];
}

export interface LLMProvider {
  name: string;
  base_url: string;
  api_key: string;
  models: string[];
}

// Settings UI types (unchanged)
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
