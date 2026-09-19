"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import useClickOutside from "@/hooks/use-clickoutside";
import { LlmDisplayInfo } from "@/lib/client";
import { cn } from "cn";
import { useEffect, useMemo, useRef, useState } from "react";

type ModelSelectorProps = {
  id?: string;
  defaultModel?: string;
  onValueChange: (model: string) => void;
  availableModels?: LlmDisplayInfo[];
  className?: string;
  align?: "center" | "start" | "end" | undefined;
};

type ModelInput = {
  value: string | null;
  label: string;
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
  const [data, setData] = useState<ModelInput>(() => {
    const model = availableModels?.find((m) => m.id === defaultModel);
    return {
      value: model?.id ?? null,
      label: model?.name ?? "",
    };
  });
  const [distance, setDistance] = useState(0);
  const modelOptions = useMemo(() => {
    return (
      availableModels
        ?.filter((m) => m.name.toLowerCase().includes(data.label.toLowerCase()))
        .map((m) => ({
          value: m.id,
          label: m.name,
        })) ?? []
    );
  }, [availableModels, data.label]);

  useEffect(() => {
    const handleScroll = () => {
      if (divRef.current) {
        const rect = divRef.current.getBoundingClientRect();
        const distanceFromBottom = window.innerHeight - rect.bottom;
        setDistance(distanceFromBottom);
      }
    };

    // Calculate once on mount
    handleScroll();

    // Listen for scroll and resize events
    window.addEventListener("scroll", handleScroll);
    window.addEventListener("resize", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, []);

  useClickOutside(divRef, () => {
    setData((prev) => {
      if (prev.value) {
        const model = availableModels?.find((m) => m.id === prev.value);
        return {
          value: model?.id ?? null,
          label: model?.name ?? "",
        };
      }
      return prev;
    });
    setIsOpen(false);
  });

  return (
    <div
      id={id}
      ref={divRef}
      className={cn("relative z-0 flex flex-col", className)}
    >
      <Input
        value={data.label}
        onMouseDown={() => setIsOpen(true)}
        onChange={(e) => {
          setData((prev) => {
            const model = availableModels?.find((m) => m.id === prev.value);
            return {
              value: model?.id ?? prev.value,
              label: e.target.value,
            };
          });
        }}
        placeholder="Model..."
        className={cn(
          "focus-visible:border-border border-border ring-0 outline-0 transition-all focus-visible:ring-0 focus-visible:outline-0",
          distance < 100 && open ? "rounded-t-none" : open && "rounded-b-none",
        )}
      />
      <div
        className={cn(
          "bg-input/30 absolute right-0 left-0 z-1000 h-40 flex-col",
          "items-start justify-start gap-1 overflow-y-auto border",
          "py-0.5 text-sm transition-all",
          open ? "flex" : "hidden",
          distance < 100
            ? "-top-40 rounded-t border-b-0"
            : "top-7 rounded-b border-t-0",
        )}
      >
        {modelOptions.map((model) => (
          <Button
            type="button"
            onClick={() => {
              setData(model);
              onValueChange(model.value);
              setIsOpen(false);
            }}
            variant="ghost"
            className={cn(
              "w-full justify-start truncate px-2",
              model.value === data.value && "bg-accent text-accent-foreground",
            )}
            key={model.value}
          >
            {model.label} {model.value === data.value && "✓"}
          </Button>
        ))}
      </div>
    </div>
  );
};
