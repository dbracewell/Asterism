import { FontSizeSelector } from "@/components/settings/font-size-selector";
import { ModelSelector } from "@/components/settings/model-selector";
import { ThemeSelector } from "@/components/settings/theme-selector";
import { Label } from "@/components/ui/label";
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
    <div className="@container/general flex min-w-0 flex-1 flex-col gap-y-8 p-2">
      <div className="flex flex-col gap-3">
        <h1 className="border-b pb-2 text-base font-bold">Appearance</h1>
        <div className="grid min-w-0 grid-cols-1 items-center gap-x-2 gap-y-3 @sm/general:grid-cols-[auto_minmax(0,1fr)]">
          <Label htmlFor="general-theme">Theme</Label>
          <ThemeSelector
            id="general-theme"
            disabled={isUpdatingUserSetting}
            currentTheme={user.settings.theme}
            onChange={(theme) => {
              updateSetting("theme", theme, false);
              setTheme(theme);
            }}
          />
          <Label htmlFor="general-font-size">Font Size</Label>
          <FontSizeSelector
            id="general-font-size"
            disabled={isUpdatingUserSetting}
            currentSize={user.settings.font_size}
            onChange={(size) => updateSetting("font_size", size, false)}
          />
          <Label htmlFor="general-show-thinking">Show Thinking</Label>
          <Checkbox
            id="general-show-thinking"
            checked={user.settings.show_thinking ?? false}
            disabled={isUpdatingUserSetting}
            onCheckedChange={(checked) => {
              updateSetting("show_thinking", !!checked, false);
            }}
          />
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <h1 className="border-b pb-2 text-base font-bold">
          <Label htmlFor="general-default-model">Default Model</Label>
        </h1>
        <div className="flex flex-col items-start gap-2">
          <ModelSelector
            id="general-default-model"
            className="w-full max-w-80 min-w-0"
            value={userSettings.default_model_id ?? undefined}
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
