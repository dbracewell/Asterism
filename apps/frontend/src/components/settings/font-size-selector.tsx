"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/features/theme/components/theme-context";
import { allowedFontSize, FONT_SIZES } from "@/features/theme/constants";

interface FontSizeSelectorProps {
  id?: string;
  currentSize?: string;
  onChange?: (size: string) => void;
  disabled?: boolean;
}

export const FontSizeSelector = ({
  id,
  currentSize,
  onChange,
  disabled,
}: FontSizeSelectorProps) => {
  const { setFontSize } = useTheme();

  const value = allowedFontSize(currentSize);

  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(size) => {
        setFontSize(size);
        onChange?.(size);
      }}
    >
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {FONT_SIZES.map((size) => (
            <SelectItem value={size} key={size}>
              {size.replace("px", "")}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};
