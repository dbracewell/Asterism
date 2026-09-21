"use client";
import { Button } from "@/components/ui/button";
import useClickOutside from "@/hooks/use-clickoutside";
import { LlmDisplayInfo } from "@/lib/client";
import { cn } from "cn";
import { ChevronDownIcon, XIcon } from "lucide-react";
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
      className={cn("bg-background relative z-40 flex flex-col", className)}
    >
      <button
        type="button"
        className={cn(
          "bg-input/30 focus-visible:border-border border-border flex h-8 items-center justify-between rounded-md border p-1 text-left text-xs ring-0 outline-0 transition-all focus-visible:ring-0 focus-visible:outline-0",
          distance < 100 && open ? "rounded-t-none" : open && "rounded-b-none",
        )}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="truncate">
          {data.label.trim() || "Select a model..."}
        </span>{" "}
        <ChevronDownIcon className="text-muted-foreground size-3" />
      </button>
      <div
        className={cn(
          "bg-input/30 absolute right-0 left-0 z-1000 flex-col text-xs",
          "items-start justify-start gap-1 border",
          "pb-0.5 text-sm transition-all",
          open ? "flex" : "hidden",
          distance < 100
            ? "bottom-7 rounded-t border-b-0"
            : "top-8 rounded-b border-t-0",
        )}
      >
        {distance >= 100 && (
          <FilterInput
            filter={filter}
            setFilter={setFilter}
            distance={distance}
            open={open}
          />
        )}
        <div className="bg-background w-full">
          <div className="bg-input/30 flex max-h-40 w-full flex-col overflow-y-auto px-0.5">
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
                  "hover:bg-primary/10 w-full justify-between! truncate px-2 text-xs!",
                  model.value === data.value &&
                    "bg-primary text-primary-foreground",
                )}
                key={model.value}
              >
                <span className="truncate">{model.label}</span>{" "}
                <span>{model.value === data.value && "✓"}</span>
              </Button>
            ))}
          </div>
        </div>
        {distance < 100 && (
          <FilterInput
            filter={filter}
            setFilter={setFilter}
            distance={distance}
            open={open}
          />
        )}
      </div>
    </div>
  );
};

const FilterInput = ({
  filter,
  setFilter,
  distance,
  open,
}: {
  filter: string;
  setFilter: (value: string) => void;
  distance: number;
  open: boolean;
}) => {
  return (
    <div
      className={cn(
        "bg-muted text-muted-foreground top-0 z-10 flex w-full items-center justify-between border-b",
        distance < 100 ? "border-t" : "border-b",
      )}
    >
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter..."
        className={cn(
          "focus-visible:border-border sticky top-0 z-10 w-full border-0 p-1 text-xs! ring-0 outline-0 transition-all focus-visible:ring-0 focus-visible:outline-0",
          distance < 100 && open ? "rounded-t-none" : open && "rounded-b-none",
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
  );
};
