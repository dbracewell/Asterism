"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/features/theme/components/theme-context";

export const FontSizeSelector = () => {
  const { fontSize, setFontSize } = useTheme();
  return (
    <Select
      defaultValue={fontSize}
      onValueChange={(fontSize) => setFontSize(fontSize)}
    >
      <SelectTrigger className="bg-input!">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {[12, 14, 16, 18, 20].map((fs) => (
          <SelectItem value={`${fs}px`} key={fs}>
            {fs}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
