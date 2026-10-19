"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LlmDisplayInfo } from "@/lib/client";
import { cn } from "@/lib/utils";

type ModelSelectorProps = {
  id?: string;
  value?: string;
  onValueChange: (model: string) => void;
  availableModels?: LlmDisplayInfo[];
  className?: string;
  align?: "center" | "start" | "end" | undefined;
  disabled?: boolean;
};

export const ModelSelector = ({
  id,
  value,
  onValueChange,
  availableModels,
  className,
  disabled = false,
}: ModelSelectorProps) => {
  const selectedModel = availableModels?.find((model) => model.id === value);

  return (
    <Select
      value={value ?? ""}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={cn("w-full", className)}>
        <SelectValue placeholder="Select a model..." />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {value && !selectedModel && (
            <SelectItem value={value} disabled>
              {value} (unavailable)
            </SelectItem>
          )}
          {availableModels?.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};
