import { ComponentProviderParameters, ComponentType } from "@/lib/client";
import React from "react";

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

export type Types = SettingsItem[];

export type ComponentOptions = {
  settings_key: string;
  title: string;
  default_value: ComponentProviderParameters | null;
};

export type ComponentRegistry = Record<ComponentType, ComponentOptions>;
