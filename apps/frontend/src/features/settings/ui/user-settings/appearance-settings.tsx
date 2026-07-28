import { FontSizeSelector } from "@/components/settings/font-size-selector";
import { ThemeSelector } from "@/components/settings/theme-selector";
import { useUpdateUserSettings } from "@/features/settings/hooks/use-update-user-settings";
import { useUser } from "@/features/auth/components/user-context";

export const AppearanceSettings = () => {
  const { updateSetting } = useUpdateUserSettings();
  const user = useUser();

  return (
    <div className="flex flex-1 flex-col gap-3 p-2">
      <h1 className="border-b pb-2 font-bold">Appearance</h1>
      <div className="grid max-w-sm grid-cols-2 gap-x-2 gap-y-3">
        <h2>Theme</h2>
        <ThemeSelector
          currentTheme={user.settings.theme}
          onChange={(theme) => updateSetting("theme", theme)}
        />
        <h2>Font Size</h2>
        <FontSizeSelector
          currentSize={user.settings.font_size}
          onChange={(size) => updateSetting("font_size", size)}
        />
      </div>
    </div>
  );
};
