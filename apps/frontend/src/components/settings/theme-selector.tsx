"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/features/theme/components/theme-context";
import { RotateCwIcon } from "lucide-react";

export const ThemeSelector = () => {
  const { currentTheme, setTheme, allThemes, refresh } = useTheme();
  return (
    <div className="flex items-center gap-2">
      <Select
        defaultValue={currentTheme}
        onValueChange={(name) => setTheme(name)}
      >
        <SelectTrigger className="bg-input!">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allThemes.map((theme) => (
            <SelectItem key={theme.filename} value={theme.filename}>
              {theme.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="icon-sm" onClick={refresh}>
        <RotateCwIcon />
      </Button>
    </div>
  );
};
