"use client";

import Constellation from "@/components/logo";
import { Button } from "@/components/ui/button";
import { useSyncExternalStore } from "react";
import type { HeroSuggestion } from "../lib/hero-suggestions";

const DRAWN_KEY = "asterism:hero-drawn";

const STAR_CLASS = "animate-star-in [animation-delay:calc(var(--node)*90ms)]";
const LINE_CLASS =
  "animate-line-in [stroke-dasharray:1] [animation-delay:calc(450ms+var(--line)*80ms)]";

const subscribe = () => () => {};
const readDrawn = () => sessionStorage.getItem(DRAWN_KEY) === "1";
// Server HTML animates so a first visit draws in before hydration; a later
// visit in the same session settles on the finished, static mark.
const serverDrawn = () => false;

/**
 * The constellation draws itself in once per browser session. Its resting
 * state is the finished mark, so reduced motion shows it static.
 */
export function HeroMark() {
  const drawn = useSyncExternalStore(subscribe, readDrawn, serverDrawn);
  return (
    <span
      aria-hidden="true"
      data-drawn={drawn}
      className="text-primary"
      ref={(node) => {
        if (!node || drawn) return;
        // Only the final connection finishes the drawing.
        const finish = (event: AnimationEvent) => {
          if (event.target === node.querySelector("line:last-of-type"))
            sessionStorage.setItem(DRAWN_KEY, "1");
        };
        node.addEventListener("animationend", finish);
        return () => node.removeEventListener("animationend", finish);
      }}
    >
      <Constellation
        fill="currentColor"
        size={72}
        strokeWidth={10}
        nodeClassName={drawn ? undefined : STAR_CLASS}
        lineClassName={drawn ? undefined : LINE_CLASS}
      />
    </span>
  );
}

export function HeroSuggestions({
  suggestions,
  disabled,
  onChoose,
}: {
  suggestions: HeroSuggestion[];
  disabled?: boolean;
  onChoose: (suggestion: HeroSuggestion) => void;
}) {
  if (!suggestions.length) return null;
  return (
    <ul
      aria-label="Suggested prompts"
      className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2"
    >
      {suggestions.map((suggestion) => (
        <li key={suggestion.id} className="min-w-0">
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="rounded-surface h-auto w-full min-w-0 flex-col items-start gap-0.5 px-3 py-2.5 text-left whitespace-normal"
            onClick={() => onChoose(suggestion)}
          >
            <span className="text-body font-medium">{suggestion.label}</span>
            <span className="text-meta text-muted-foreground line-clamp-2 font-normal">
              {suggestion.detail}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
