"use client";

import { COMPOSER_CHIP } from "../lib/composer-chip";
import { ComposerNotice } from "./composer-notice";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { learningModeQueryOptions } from "@/features/chat/components/chat-learning-mode-picker";
import {
  bundledRubricsOptions,
  rubricListOptions,
} from "@/features/templates/queries";
import type { LearningModeId, RubricUse } from "@/lib/client";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheckIcon } from "lucide-react";

const NONE = "none";

const encode = (use: RubricUse | null) =>
  use ? `${use.source}:${use.id}` : NONE;

const decode = (value: string): RubricUse | null => {
  if (value === NONE) return null;
  const split = value.indexOf(":");
  return {
    source: value.slice(0, split) as RubricUse["source"],
    id: value.slice(split + 1),
  };
};

/** Whether turns in this learning mode take a rubric (from the catalog). */
export function useModeTakesRubric(mode: LearningModeId | null | undefined) {
  const catalog = useQuery(learningModeQueryOptions());
  return !!catalog.data?.modes.find((item) => item.id === mode)
    ?.rubric_feedback;
}

/**
 * Chooses the rubric a Draft feedback turn is assessed against (US-57.1).
 * The choice stays selected for later turns until the learner changes it; the
 * server pins the rubric's current document on each accepted turn.
 */
export function ChatRubricPicker({
  owner,
  value,
  onChange,
  disabled = false,
}: {
  owner: string;
  value: RubricUse | null;
  onChange: (value: RubricUse | null) => void;
  disabled?: boolean;
}) {
  const bundled = useQuery(bundledRubricsOptions());
  const owned = useQuery(rubricListOptions(owner));
  const loaded = !!bundled.data && !!owned.data;
  const known =
    value === null ||
    (value.source === "bundled"
      ? !!bundled.data?.items.some((item) => item.id === value.id)
      : !!owned.data?.items.some((item) => item.id === value.id));
  const error = bundled.error ?? owned.error;
  return (
    <>
      <Select
        value={encode(value)}
        onValueChange={(next) => onChange(decode(next))}
        disabled={disabled || !loaded}
      >
        <SelectTrigger aria-label="Rubric" className={COMPOSER_CHIP}>
          <ClipboardCheckIcon className="text-muted-foreground" />
          <SelectValue placeholder="Rubric" />
        </SelectTrigger>
        <SelectContent className="max-w-[min(20rem,calc(100vw-1rem))]">
          <SelectGroup>
            <SelectItem value={NONE}>No rubric</SelectItem>
            {!known && (
              <SelectItem value={encode(value)} disabled>
                {loaded ? "Unavailable rubric" : "Loading rubrics…"}
              </SelectItem>
            )}
          </SelectGroup>
          {!!bundled.data?.items.length && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Bundled</SelectLabel>
                {bundled.data.items.map((item) => (
                  <SelectItem
                    key={item.id}
                    value={`bundled:${item.id}`}
                    description={item.description}
                  >
                    {item.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
          {!!owned.data?.items.length && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Your rubrics</SelectLabel>
                {owned.data.items.map((item) => (
                  <SelectItem
                    key={item.id}
                    value={`owned:${item.id}`}
                    description={item.description}
                  >
                    {item.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
        </SelectContent>
      </Select>
      {error && (
        <ComposerNotice role="alert" className="text-destructive">
          Could not load rubrics.
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={bundled.isFetching || owned.isFetching}
            onClick={() => {
              if (bundled.error) void bundled.refetch();
              if (owned.error) void owned.refetch();
            }}
          >
            Retry rubrics
          </Button>
        </ComposerNotice>
      )}
    </>
  );
}
