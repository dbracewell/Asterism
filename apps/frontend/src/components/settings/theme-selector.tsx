"use client";

import { Button } from "@/components/ui/button";
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
import { RotateCwIcon } from "lucide-react";

interface ThemeSelectorProps {
  currentTheme?: string;
  onChange?: (theme: string) => void;
}

export const ThemeSelector = ({
  currentTheme,
  onChange,
}: ThemeSelectorProps) => {
  const { setTheme, allThemes, refresh } = useTheme();

  const value = currentTheme ?? "light";
  const darkThemes = allThemes.filter((theme) => theme.type === "dark");
  const lightThemes = allThemes.filter((theme) => theme.type === "light");

  return (
    <div className="flex items-center gap-2">
      <Select
        defaultValue={value}
        onValueChange={(name) => {
          setTheme(name);
          onChange?.(name);
        }}
      >
        <SelectTrigger className="bg-input!">
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
      <Button variant="ghost" size="icon-sm" onClick={refresh}>
        <RotateCwIcon />
      </Button>
    </div>
  );
};
