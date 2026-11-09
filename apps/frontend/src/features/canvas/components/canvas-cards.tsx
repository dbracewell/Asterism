"use client";
import { Button } from "@/components/ui/button";
import type { ToolResult } from "@/lib/client";
import { PanelRightOpenIcon } from "lucide-react";
import { canvasRefs } from "../lib/canvas";
import { useCanvas } from "./canvas-context";

/** A card for each canvas item a message wrote; opens it in the panel. */
export function CanvasCards({ results }: { results: ToolResult[] }) {
  const canvas = useCanvas();
  const refs = canvasRefs(results);
  if (!canvas || !refs.length) return null;
  return (
    <ul aria-label="Canvas items" className="flex flex-col gap-2">
      {refs.map((ref) => {
        const isOpen = canvas.openItemId === ref.itemId;
        return (
          <li
            key={ref.itemId}
            className="bg-card rounded-surface flex max-w-md items-center gap-3 border px-3 py-2"
          >
            <PanelRightOpenIcon
              aria-hidden="true"
              className="text-muted-foreground size-4 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{ref.title}</p>
              <p className="text-muted-foreground text-xs">
                {ref.created ? "Created" : "Updated"} · version {ref.version}
              </p>
            </div>
            <Button
              type="button"
              variant={isOpen ? "secondary" : "outline"}
              size="sm"
              aria-label={`Open canvas ${ref.title}`}
              aria-pressed={isOpen}
              onClick={() =>
                isOpen ? canvas.close() : canvas.open(ref.itemId)
              }
            >
              {isOpen ? "Close" : "Open"}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
