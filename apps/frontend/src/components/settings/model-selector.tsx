import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LlmDisplayInfo } from "@/lib/client";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";

type ModelSelectorProps = {
  id?: string;
  defaultModel?: string;
  onValueChange: (model: string) => void;
  availableModels?: LlmDisplayInfo[];
  className?: string;
  align?: "center" | "start" | "end" | undefined;
};

export const ModelSelector = ({
  id,
  defaultModel,
  onValueChange,
  availableModels,
  className,
  align = "center",
}: ModelSelectorProps) => {
  const [model, setModel] = useState(defaultModel ?? "");
  const modelOptions = useMemo(() => {
    return (
      availableModels?.map((m) => ({
        value: m.id,
        label: m.name,
      })) ?? []
    );
  }, [availableModels]);

  return (
    <Select
      value={model}
      onValueChange={(v) => {
        setModel(v);
        onValueChange(v);
      }}
    >
      <SelectTrigger id={id} className={cn("min-w-0 truncate", className)}>
        <span className="block w-full truncate text-left">
          <SelectValue placeholder="Select a model" />
        </span>
      </SelectTrigger>
      <SelectContent
        position="popper"
        align={align}
        className="max-h-60 overflow-y-auto"
      >
        {modelOptions.map((model) => (
          <SelectItem
            value={model.value}
            key={model.value}
            className="block min-w-0! truncate text-xs"
          >
            <span className="block w-[92%] truncate">{model.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
