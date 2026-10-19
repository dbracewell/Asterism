"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/features/theme/components/theme-context";

interface ThemeSelectorProps {
  currentTheme?: string;
  onChange?: (theme: string) => void;
  updateTheme?: boolean;
  disabled?: boolean;
}

export const ThemeSelector = ({
  currentTheme,
  onChange,
  disabled,
}: ThemeSelectorProps) => {
  const { lightThemes, darkThemes } = useTheme();

  const value = currentTheme ?? "light";

  return (
    <div className="flex items-center gap-2">
      <Select
        defaultValue={value}
        disabled={disabled}
        onValueChange={(name) => {
          onChange?.(name);
        }}
      >
        <SelectTrigger className="min-w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-80 overflow-y-auto" position="popper">
          {lightThemes.length > 0 && (
            <SelectGroup>
              <SelectLabel className="text-muted-foreground border-b text-xs font-semibold">
                Light
              </SelectLabel>
              {lightThemes.map((theme) => (
                <SelectItem key={theme.filename} value={theme.filename}>
                  {theme.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {darkThemes.length > 0 && (
            <SelectGroup>
              <SelectLabel className="text-muted-foreground border-b text-xs font-semibold">
                Dark
              </SelectLabel>
              {darkThemes.map((theme) => (
                <SelectItem key={theme.filename} value={theme.filename}>
                  {theme.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </div>
  );
};
