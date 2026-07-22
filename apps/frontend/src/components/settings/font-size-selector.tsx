"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/features/theme/components/theme-context";

interface FontSizeSelectorProps {
  currentSize?: string;
  onChange?: (size: string) => void;
}

export const FontSizeSelector = ({
  currentSize,
  onChange,
}: FontSizeSelectorProps) => {
  const { setFontSize } = useTheme();

  const value = currentSize ?? "16px";

  return (
    <Select
      defaultValue={value}
      onValueChange={(size) => {
        setFontSize(size);
        onChange?.(size);
      }}
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
