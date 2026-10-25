"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { eligibleSkillOptions } from "@/features/skills/queries";
import type {
  ActiveSkill,
  ActiveSkillState,
  SkillSelection,
  SkillSummary,
} from "@/lib/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpIcon, RefreshCwIcon, XIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useState,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { parseSkillCommands, slashSearch } from "../lib/skill-commands";

export type SkillComposerControl = {
  prompt: string;
  changePrompt: (value: string) => void;
  prepare: (
    prompt: string,
  ) => Promise<{ prompt: string; skills?: SkillSelection }>;
  accepted: () => void;
  hasSkills: boolean;
  ready: boolean;
  controls: ReactNode;
  keyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  inputProps: {
    "aria-controls"?: string;
    "aria-expanded": boolean;
    "aria-activedescendant"?: string;
    "aria-autocomplete": "list";
  };
};
type Draft = {
  revision: number;
  skills: ActiveSkill[];
  refresh: string[];
  prompt: string;
  literal: boolean;
};

export function SkillComposer({
  owner,
  scope,
  state,
  disabled,
  children,
}: {
  owner: string;
  scope: string;
  state?: ActiveSkillState;
  disabled?: boolean;
  children: (control: SkillComposerControl) => ReactNode;
}) {
  const revision = state?.revision ?? 0;
  const baseSkills = state?.skills ?? [];
  const storageKey = `asterism:skill-composer:1:${owner}:${scope}`;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [manual, setManual] = useState(false);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string>();
  const [resolving, setResolving] = useState(false);
  const listId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  // Local draft persistence is separate from API state. Storage is never read on the server.
  useEffect(() => {
    let restored: Draft | null = null;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const value = JSON.parse(raw);
        if (
          Number.isInteger(value.revision) &&
          Array.isArray(value.skills) &&
          value.skills.length <= 8 &&
          value.skills.every(
            (s: ActiveSkill) =>
              typeof s.id === "string" && typeof s.name === "string",
          ) &&
          Array.isArray(value.refresh) &&
          value.refresh.every((id: unknown) => typeof id === "string") &&
          typeof value.prompt === "string"
        )
          restored = value;
      }
    } catch {
      /* Unavailable or malformed storage must not block composition. */
    }
    setDraft(
      restored ?? {
        revision,
        skills: baseSkills,
        refresh: [],
        prompt: "",
        literal: false,
      },
    );
    // Scope changes remount this component; accepted state is captured as the draft baseline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  const stored: Draft = draft ?? {
    revision,
    skills: baseSkills,
    refresh: [],
    prompt: "",
    literal: false,
  };
  const current: Draft = {
    ...stored,
    skills: stored.skills.map((skill) => {
      const live = baseSkills.find(
        (item) => item.id === skill.id && item.revision === skill.revision,
      );
      return live
        ? {
            ...skill,
            available: live.available,
            update_available: live.update_available,
          }
        : skill;
    }),
  };
  function update(next: Draft) {
    setDraft(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* Optional persistence. */
    }
    setError(undefined);
  }
  const search = slashSearch(current.prompt);
  const open = !disabled && !dismissed && (manual || search !== null);
  const query = useQuery({
    ...eligibleSkillOptions(owner, manual ? "" : (search ?? "")),
    enabled: open,
  });
  const options = query.data?.items ?? [];
  const activeIndex = Math.min(index, Math.max(0, options.length - 1));
  useEffect(() => {
    if (open && options.length)
      document
        .getElementById(`${listId}-${activeIndex}`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [open, listId, activeIndex, options.length]);
  const dirty =
    current.skills.map((s) => s.id).join() !==
      baseSkills.map((s) => s.id).join() || current.refresh.length > 0;
  const stale = current.revision !== revision;
  async function resolveName(name: string) {
    try {
      const result = await queryClient.fetchQuery(
        eligibleSkillOptions(owner, name),
      );
      const item = result.items.find((skill) => skill.name === name);
      if (!item || !result.policy_enabled)
        throw new Error(`/${name} is unknown or unavailable.`);
      return item;
    } catch (failure) {
      const message =
        failure instanceof Error
          ? failure.message
          : `Could not resolve /${name}. Retry or send literally.`;
      setError(message);
      throw new Error(message);
    }
  }
  async function add(item: SkillSummary) {
    if (resolving) return;
    setResolving(true);
    try {
      const prefix =
        search !== null ? current.prompt.replace(/\/[a-z0-9-]*$/, "") : "";
      const parsed = parseSkillCommands(prefix);
      const selected = [...current.skills];
      const refresh = new Set(current.refresh);
      for (const name of parsed.names) {
        const match = await resolveName(name);
        if (
          selected.some(
            (skill) =>
              skill.id === match.id &&
              skill.revision !== match.revision &&
              skill.digest,
          )
        )
          refresh.add(match.id);
        if (!selected.some((skill) => skill.id === match.id))
          selected.push({ ...match, digest: "", available: true });
      }
      if (
        selected.some(
          (skill) =>
            skill.id === item.id &&
            skill.revision !== item.revision &&
            skill.digest,
        )
      )
        refresh.add(item.id);
      if (!selected.some((skill) => skill.id === item.id))
        selected.push({ ...item, digest: "", available: true });
      if (selected.length > 8)
        throw new Error("At most eight skills can be active.");
      update({
        ...current,
        prompt: search !== null ? parsed.prompt : current.prompt,
        skills: selected,
        refresh: [...refresh],
      });
      setManual(false);
      setDismissed(true);
      setIndex(0);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not resolve skills. Retry or send literally.",
      );
    } finally {
      setResolving(false);
      requestAnimationFrame(() =>
        anchorRef.current?.querySelector("textarea")?.focus(),
      );
    }
  }
  async function prepare(prompt: string) {
    setDismissed(true);
    setManual(false);
    if (!draft) throw new Error("Restoring skill draft. Please retry.");
    if (stale)
      throw new Error(
        "Active skills changed in another tab. Reload current skills before sending.",
      );
    const selected = [...current.skills];
    const refresh = new Set(current.refresh);
    let body = prompt;
    if (!current.literal) {
      const parsed = parseSkillCommands(prompt);
      for (const name of parsed.names) {
        const match = await resolveName(name);
        if (
          selected.some(
            (skill) =>
              skill.id === match.id &&
              skill.revision !== match.revision &&
              skill.digest,
          )
        )
          refresh.add(match.id);
        if (!selected.some((s) => s.id === match.id))
          selected.push({ ...match, digest: "", available: true });
      }
      body = parsed.names.length ? parsed.prompt : prompt;
    }
    if (selected.length > 8)
      throw new Error("At most eight skills can be active.");
    if (selected.some((s) => s.available === false))
      throw new Error("Remove unavailable skills before sending.");
    const changed =
      dirty ||
      refresh.size > 0 ||
      selected.map((s) => s.id).join() !== baseSkills.map((s) => s.id).join();
    return {
      prompt: body.trim(),
      ...(changed || (!body.trim() && selected.length)
        ? {
            skills: {
              expected_revision: current.revision,
              skill_ids: selected.map((s) => s.id),
              refresh_ids: [...refresh],
            },
          }
        : {}),
    };
  }
  const controls = (
    <div className="flex min-w-0 flex-col gap-2 px-3 pt-2">
      <div
        className="flex min-w-0 flex-wrap items-center gap-1"
        aria-label="Active skills"
      >
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || !draft}
          onClick={() => {
            setManual(true);
            setDismissed(false);
            requestAnimationFrame(() =>
              anchorRef.current?.querySelector("textarea")?.focus(),
            );
          }}
        >
          Skills /
        </Button>
        {current.skills.map((skill, position) => (
          <div
            key={skill.id}
            className="flex max-w-full min-w-0 flex-wrap items-center gap-0.5"
          >
            <Badge
              variant={skill.available === false ? "destructive" : "secondary"}
              className="max-w-48 shrink truncate"
              title={skill.name}
            >
              {skill.name} · {skill.digest ? `r${skill.revision}` : "pending"}
            </Badge>
            {skill.available === false && (
              <span className="text-destructive text-xs">Unavailable</span>
            )}
            {(skill.update_available || current.refresh.includes(skill.id)) && (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={disabled}
                title="Update available; refresh on next send"
                aria-label={`Refresh ${skill.name}`}
                onClick={() =>
                  update({
                    ...current,
                    refresh: [...new Set([...current.refresh, skill.id])],
                  })
                }
              >
                <RefreshCwIcon />
              </Button>
            )}
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              disabled={disabled || position === 0}
              aria-label={`Move ${skill.name} earlier`}
              onClick={() => {
                const skills = [...current.skills];
                [skills[position - 1], skills[position]] = [
                  skills[position],
                  skills[position - 1],
                ];
                update({ ...current, skills });
              }}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              disabled={disabled || position === current.skills.length - 1}
              aria-label={`Move ${skill.name} later`}
              onClick={() => {
                const skills = [...current.skills];
                [skills[position + 1], skills[position]] = [
                  skills[position],
                  skills[position + 1],
                ];
                update({ ...current, skills });
              }}
            >
              <ArrowDownIcon />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              disabled={disabled}
              aria-label={`Remove ${skill.name}`}
              onClick={() =>
                update({
                  ...current,
                  skills: current.skills.filter((s) => s.id !== skill.id),
                  refresh: current.refresh.filter((id) => id !== skill.id),
                })
              }
            >
              <XIcon />
            </Button>
          </div>
        ))}
      </div>
      {(dirty || current.refresh.length > 0) && (
        <p role="status" className="text-muted-foreground text-xs">
          Skill changes apply to the next accepted message.
          {current.refresh.length > 0 ? " Refresh pending." : ""}
        </p>
      )}
      {stale && (
        <p role="alert" className="text-destructive text-xs">
          Active skills changed. Your draft is retained.{" "}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              if (
                window.confirm(
                  "Discard pending skill changes and reload current skills? Your message will be kept.",
                )
              )
                update({
                  ...current,
                  revision,
                  skills: baseSkills,
                  refresh: [],
                });
            }}
          >
            Reload current skills
          </Button>
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}{" "}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => update({ ...current, literal: true })}
          >
            Send as literal text
          </Button>
        </p>
      )}
      {current.literal && (
        <p role="status" className="text-muted-foreground text-xs">
          Slash text will be sent literally.{" "}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => update({ ...current, literal: false })}
          >
            Interpret commands
          </Button>
        </p>
      )}
    </div>
  );
  const control: SkillComposerControl = {
    prompt: current.prompt,
    changePrompt(value) {
      update({ ...current, prompt: value, literal: false });
      setDismissed(false);
      setManual(false);
      setIndex(0);
    },
    prepare,
    accepted() {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {}
      setDraft({ ...current, prompt: "", refresh: [], literal: false });
    },
    hasSkills: current.skills.length > 0,
    ready: !!draft && !resolving,
    controls,
    inputProps: {
      "aria-controls": open ? listId : undefined,
      "aria-expanded": open,
      "aria-activedescendant":
        open && options.length ? `${listId}-${activeIndex}` : undefined,
      "aria-autocomplete": "list",
    },
    keyDown(event) {
      if (
        event.nativeEvent.isComposing ||
        event.keyCode === 229 ||
        event.shiftKey
      )
        return false;
      if (!open) return false;
      if (event.key === "Escape") {
        setDismissed(true);
        setManual(false);
        return true;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        setIndex(
          (activeIndex +
            (event.key === "ArrowDown" ? 1 : -1) +
            Math.max(1, options.length)) %
            Math.max(1, options.length),
        );
        return true;
      }
      if (event.key === "Enter") {
        if (query.isError || query.isPending || !options.length) {
          setDismissed(true);
          return true;
        }
        void add(options[activeIndex]);
        return true;
      }
      return false;
    },
  };
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setDismissed(true);
          setManual(false);
        }
      }}
    >
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="min-w-0">
          {children(control)}
        </div>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        className="max-h-[min(20rem,50dvh)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if ((e.target as HTMLElement).closest("textarea")) e.preventDefault();
        }}
      >
        <div
          id={listId}
          role="listbox"
          aria-label="Eligible skills"
          className="flex flex-col gap-1"
        >
          {query.isPending ? (
            <p role="status">Loading skills…</p>
          ) : query.isError ? (
            <Empty role="alert">
              <EmptyHeader>
                <EmptyTitle>Could not load skills</EmptyTitle>
                <EmptyDescription>Your message is kept.</EmptyDescription>
              </EmptyHeader>
              <Button type="button" onClick={() => void query.refetch()}>
                Retry skills
              </Button>
            </Empty>
          ) : !query.data?.policy_enabled ? (
            <p>Skill activation is disabled by an administrator.</p>
          ) : !options.length ? (
            <p>No matching assigned skills. Manage skills in User Settings.</p>
          ) : (
            options.map((item, i) => (
              <Button
                key={item.id}
                id={`${listId}-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={i === activeIndex}
                variant={i === activeIndex ? "secondary" : "ghost"}
                className="h-auto min-h-11 justify-start text-left whitespace-normal"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void add(item)}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="break-all">/{item.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {item.description}
                  </span>
                </span>
              </Button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
