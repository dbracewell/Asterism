import { FontSizeSelector } from "@/components/settings/font-size-selector";
import { ModelSelector } from "@/components/settings/model-selector";
import { ThemeSelector } from "@/components/settings/theme-selector";
import { Checkbox } from "@/components/ui/checkbox";
import { useUser } from "@/features/auth/components/user-context";
import { useUpdateUserSettings } from "@/features/settings/hooks/use-update-user-settings";
import { useTheme } from "@/features/theme/components/theme-context";

export const GeneralSettings = () => {
  const { updateSetting, isUpdatingUserSetting } = useUpdateUserSettings();
  const user = useUser();
  const userSettings = user.settings;
  const { setTheme } = useTheme();

  return (
    <div className="flex flex-1 flex-col gap-y-8 p-2">
      <div className="flex flex-col gap-3">
        <h1 className="border-b pb-2 text-base font-bold">Appearance</h1>
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-3">
          <h2>Theme</h2>
          <ThemeSelector
            disabled={isUpdatingUserSetting}
            currentTheme={user.settings.theme}
            onChange={(theme) => {
              updateSetting("theme", theme, false);
              setTheme(theme);
            }}
          />
          <h2>Font Size</h2>
          <FontSizeSelector
            disabled={isUpdatingUserSetting}
            currentSize={user.settings.font_size}
            onChange={(size) => updateSetting("font_size", size, false)}
          />
          <h2>Show Thinking</h2>
          <Checkbox
            checked={user.settings.show_thinking ?? false}
            disabled={isUpdatingUserSetting}
            onCheckedChange={(checked) => {
              updateSetting("show_thinking", !!checked, false);
            }}
          />
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <h1 className="border-b pb-2 text-base font-bold">Default Model</h1>
        <div className="flex flex-col items-start gap-2">
          <ModelSelector
            className="w-40! sm:w-80!"
            defaultModel={userSettings.default_model_id ?? undefined}
            onValueChange={(v) => {
              updateSetting("default_model_id", v);
            }}
            availableModels={Object.values(userSettings.models ?? {})}
          />
        </div>
      </div>
    </div>
  );
};
