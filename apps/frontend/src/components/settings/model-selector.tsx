"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import useClickOutside from "@/hooks/use-clickoutside";
import { LlmDisplayInfo } from "@/lib/client";
import { cn } from "cn";
import { useMemo, useRef, useState } from "react";

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
}: ModelSelectorProps) => {
  const divRef = useRef<HTMLDivElement>(null);
  const [open, setIsOpen] = useState(false);
  const [input, setInput] = useState(
    () => availableModels?.find((m) => m.id === defaultModel)?.name ?? "",
  );
  const [model, setModel] = useState(
    () => availableModels?.find((m) => m.id === defaultModel)?.name ?? "",
  );
  const modelOptions = useMemo(() => {
    return (
      availableModels
        ?.filter((m) => m.name.toLowerCase().includes(input.toLowerCase()))
        .map((m) => ({
          value: m.id,
          label: m.name,
        })) ?? []
    );
  }, [availableModels, input]);

  useClickOutside(divRef, () => {
    if (model) {
      setInput(availableModels?.find((m) => m.name === model)?.name ?? "");
    } else {
      setInput("");
    }
    setIsOpen(false);
  });

  return (
    <div
      id={id}
      ref={divRef}
      className={cn("relative flex flex-col", className)}
    >
      <Input
        value={input}
        onMouseDown={() => setIsOpen(true)}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Model..."
        className="focus-visible:border-border border-border ring-0 outline-0 transition-all group-focus-within:rounded-b-none focus-visible:ring-0 focus-visible:outline-0"
      />
      <div
        className={cn(
          "bg-input absolute top-7 right-0 left-0 z-100 max-h-40 flex-col",
          "items-start justify-start gap-1 overflow-y-auto rounded-b border",
          "border-t-0 py-0.5 text-sm transition-all",
          open ? "flex" : "hidden",
        )}
      >
        {modelOptions.map((model) => (
          <Button
            type="button"
            onClick={() => {
              setModel(model.label);
              onValueChange(model.value);
              setInput(model.label);
              setIsOpen(false);
            }}
            variant="ghost"
            className="w-full justify-start px-2"
            key={model.value}
          >
            {model.label}
          </Button>
        ))}
      </div>
    </div>
  );
};
