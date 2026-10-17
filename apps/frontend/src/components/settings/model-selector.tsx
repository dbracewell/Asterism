"use client";
import { Button } from "@/components/ui/button";
import useClickOutside from "@/hooks/use-clickoutside";
import { LlmDisplayInfo } from "@/lib/client";
import { cn } from "cn";
import { ChevronDownIcon, XIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

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
  const divRef = useRef<HTMLDivElement>(null);
  const [open, setIsOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const menuId = useId();
  const selectedModel = availableModels?.find((model) => model.id === value);
  const selectedLabel =
    selectedModel?.name ?? (value ? `${value} (unavailable)` : "");
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

  useClickOutside(divRef, () => setIsOpen(false));

  return (
    <div
      ref={divRef}
      className={cn("bg-input/30 relative z-400 flex flex-col", className)}
    >
      <Button
        id={id}
        variant="outline"
        aria-expanded={open && !disabled}
        aria-controls={menuId}
        type="button"
        disabled={disabled}
        className={cn(
          "h-8 w-full justify-between text-left",
          distance < 100 && open ? "rounded-t-none" : open && "rounded-b-none",
        )}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="truncate">
          {selectedLabel.trim() || "Select a model..."}
        </span>{" "}
        <ChevronDownIcon className="text-muted-foreground" />
      </Button>
      <div
        id={menuId}
        className={cn(
          "bg-input",
          "absolute right-0 left-0 z-1000 flex-1 flex-col text-xs",
          "min-h-40 items-start justify-start border",
          "pb-0.5 text-sm transition-all",
          open && !disabled ? "flex" : "hidden",
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
        <div className="bg-input w-full pt-2 shadow-2xl">
          <div className="bg-input flex max-h-40 w-full flex-col overflow-y-auto px-0.5">
            {modelOptions.map((model) => (
              <Button
                type="button"
                onClick={() => {
                  if (!disabled) {
                    onValueChange(model.value);
                  }
                  setIsOpen(false);
                }}
                variant="ghost"
                className={cn(
                  "hover:bg-primary/10 w-full justify-between! truncate px-2 text-xs!",
                  model.value === value && "bg-primary text-primary-foreground",
                )}
                key={model.value}
              >
                <span className="truncate">{model.label}</span>{" "}
                <span>{model.value === value && "✓"}</span>
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
        "bg-input/30 text-muted-foreground top-0 z-10 flex w-full items-center justify-between border-b",
        distance < 100 ? "border-t" : "border-b",
      )}
    >
      <input
        aria-label="Filter models"
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
        aria-label="Clear model filter"
        onClick={() => setFilter("")}
      >
        <XIcon />
      </Button>
    </div>
  );
};
