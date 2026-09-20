"use client";
import { Button } from "@/components/ui/button";
import useClickOutside from "@/hooks/use-clickoutside";
import { LlmDisplayInfo } from "@/lib/client";
import { cn } from "cn";
import { XIcon } from "lucide-react";
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
  const [filter, setFilter] = useState("");
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
        ?.filter(
          (m) =>
            !filter.trim() ||
            m.name.toLowerCase().includes(filter.trim().toLowerCase()),
        )
        .map((m) => ({
          value: m.id,
          label: m.name,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)) ?? []
    );
  }, [availableModels, filter]);

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
      className={cn("relative z-40 flex flex-col", className)}
    >
      <button
        type="button"
        className={cn(
          "bg-input/30 focus-visible:border-border border-border flex h-8 items-center rounded-md border p-1 text-left text-base ring-0 outline-0 transition-all focus-visible:ring-0 focus-visible:outline-0",
          distance < 100 && open ? "rounded-t-none" : open && "rounded-b-none",
        )}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {data.label.trim() || "Select a model..."}
      </button>
      <div
        className={cn(
          "bg-input absolute right-0 left-0 z-1000 h-40 flex-col text-sm",
          "items-start justify-start gap-1 border",
          "pb-0.5 text-sm transition-all",
          open ? "flex" : "hidden",
          distance < 100
            ? "bottom-8 rounded-t border-b-0"
            : "top-8 rounded-b border-t-0",
        )}
      >
        <div className="bg-accent text-accent-foreground top-0 z-10 flex w-full items-center justify-between border-b">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter..."
            className={cn(
              "focus-visible:border-border sticky top-0 z-10 w-full border-0 p-1 text-sm ring-0 outline-0 transition-all focus-visible:ring-0 focus-visible:outline-0",
              distance < 100 && open
                ? "rounded-t-none"
                : open && "rounded-b-none",
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setFilter("")}
          >
            <XIcon />
          </Button>
        </div>
        <div className="flex max-h-36 w-full flex-col overflow-y-auto">
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
                model.value === data.value &&
                  "bg-primary text-primary-foreground",
              )}
              key={model.value}
            >
              {model.label} {model.value === data.value && "✓"}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
};
