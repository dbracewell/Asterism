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
  disabled?: boolean;
}

export const FontSizeSelector = ({
  currentSize,
  onChange,
  disabled,
}: FontSizeSelectorProps) => {
  const { setFontSize } = useTheme();

  const value = currentSize ?? "16px";

  return (
    <Select
      defaultValue={value}
      disabled={disabled}
      onValueChange={(size) => {
        setFontSize(size);
        onChange?.(size);
      }}
    >
      <SelectTrigger>
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
