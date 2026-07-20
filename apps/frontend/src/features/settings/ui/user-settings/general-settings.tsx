import { FontSizeSelector } from "@/components/settings/font-size-selector";
import { ThemeSelector } from "@/components/settings/theme-selector";

export const GeneralSettings = () => {
  return (
    <div className="flex w-full max-w-60 flex-1 flex-col justify-end gap-3">
      <div className="grid grid-cols-2 gap-x-2 gap-y-3">
        <h2>Theme</h2>
        <ThemeSelector />
        <h2>Font Size</h2>
        <FontSizeSelector />
      </div>
    </div>
  );
};
