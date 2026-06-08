"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/hooks/use-theme";

export const ThemeSelector = () => {
  const { theme, setTheme, themeList } = useTheme();
  return (
    <Select defaultValue={theme} onValueChange={(name) => setTheme(name)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {themeList.map((theme) => (
          <SelectItem key={theme.filename} value={theme.filename}>
            {theme.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
