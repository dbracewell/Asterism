import { FontSizeSelector } from "@/components/settings/font-size-selector";
import { ThemeSelector } from "@/components/settings/theme-selector";
import { useUpdateUserSettings } from "@/features/settings/hooks/use-update-user-settings";
import { useUser } from "@/features/auth/components/user-context";

export const GeneralSettings = () => {
  const { updateSetting } = useUpdateUserSettings();
  const user = useUser();

  return (
    <div className="flex w-full max-w-60 flex-1 flex-col justify-end gap-3">
      <div className="grid grid-cols-2 gap-x-2 gap-y-3">
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
