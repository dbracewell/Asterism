"use client";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { eligibleSkillOptions } from "@/features/skills/queries";
import type {
  AppliedTemplate,
  TemplateSelection,
} from "@/features/templates/components/template-picker-dialog";
import { templateSlashOptions } from "@/features/templates/lib/slash";
import {
  frameworkCatalogOptions,
  templateListOptions,
} from "@/features/templates/queries";
import type {
  ActiveSkill,
  ActiveSkillState,
  SkillSelection,
  SkillSummary,
} from "@/lib/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  RefreshCwIcon,
  SlashIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useEffect,
  useId,
  useState,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { COMPOSER_CHIP } from "../lib/composer-chip";
import { parseSkillCommands, slashSearch } from "../lib/skill-commands";
import { isScaffoldingLevel } from "@/features/templates/lib/levels";

export type SkillComposerControl = {
  prompt: string;
  /** Replaces the prompt; a template, when given, labels the new text. */
  changePrompt: (value: string, template?: AppliedTemplate) => void;
  prepare: (
    prompt: string,
  ) => Promise<{ prompt: string; skills?: SkillSelection }>;
  accepted: () => void;
  /** The template label describing the draft; persisted with the prompt. */
  template: AppliedTemplate | null;
  changeTemplate: (template: AppliedTemplate | null) => void;
  hasSkills: boolean;
  ready: boolean;
  /** One chip per active skill for the composer's top row. */
  chips: ReactNode;
  /** Pending-change, conflict and error lines below the top row. */
  notices: ReactNode;
  canOpenList: boolean;
  /** Opens the skill list, as typing "/" does; the caller focuses the box. */
  openList: () => void;
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
  template: AppliedTemplate | null;
};

/** Restored labels are only a client claim; the server re-resolves them on send. */
function restoredTemplate(value: unknown): AppliedTemplate | null {
  if (!value || typeof value !== "object") return null;
  const { name, use } = value as Partial<AppliedTemplate>;
  return typeof name === "string" &&
    use &&
    (use.source === "framework" || use.source === "template") &&
    typeof use.id === "string" &&
    Number.isInteger(use.revision) &&
    isScaffoldingLevel(use.level)
    ? { name, use }
    : null;
}

export function SkillComposer({
  owner,
  scope,
  state,
  disabled,
  onOpenTemplate,
  children,
}: {
  owner: string;
  scope: string;
  state?: ActiveSkillState;
  disabled?: boolean;
  /** Slash discovery hands template choices to the composer's builder. */
  onOpenTemplate?: (selection: TemplateSelection | null) => void;
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
          restored = {
            ...value,
            literal: value.literal === true,
            template: restoredTemplate(value.template),
          };
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
        template: null,
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
    template: null,
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
  // Templates are offered only for typed slash searches, not the Skills menu item.
  const templateSearch = onOpenTemplate && !manual ? search : null;
  const frameworks = useQuery({
    ...frameworkCatalogOptions(),
    enabled: open && templateSearch !== null,
  });
  const ownedTemplates = useQuery({
    ...templateListOptions(owner),
    enabled: open && templateSearch !== null,
  });
  const templateOptions =
    templateSearch === null
      ? []
      : templateSlashOptions(templateSearch, {
          frameworks: frameworks.data?.items ?? [],
          templates: ownedTemplates.data?.items ?? [],
        });
  const skillOptions = query.data?.policy_enabled
    ? (query.data?.items ?? [])
    : [];
  const options = [
    ...skillOptions.map((item) => ({ kind: "skill" as const, item })),
    ...templateOptions.map((item) => ({ kind: "template" as const, item })),
  ];
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
  function openTemplate(selection: TemplateSelection | null) {
    // The slash token was a command, not message text.
    update({
      ...current,
      prompt: current.prompt.replace(/(^|\s)\/[a-z0-9-]*$/, "$1"),
    });
    setManual(false);
    setDismissed(true);
    setIndex(0);
    onOpenTemplate?.(selection);
  }
  function choose(option: (typeof options)[number]) {
    if (option.kind === "skill") void add(option.item);
    else openTemplate(option.item.selection);
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
  const move = (position: number, offset: -1 | 1) => {
    const skills = [...current.skills];
    [skills[position + offset], skills[position]] = [
      skills[position],
      skills[position + offset],
    ];
    update({ ...current, skills });
  };
  const chips = current.skills.map((skill, position) => {
    const unavailable = skill.available === false;
    const refreshing = current.refresh.includes(skill.id);
    return (
      <DropdownMenu key={skill.id} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant={unavailable ? "destructive" : "secondary"}
            size="sm"
            disabled={disabled}
            className={cn(COMPOSER_CHIP, "max-w-56")}
            aria-label={`Skill ${skill.name}${unavailable ? ", unavailable" : ""}${
              skill.update_available || refreshing ? ", update available" : ""
            }`}
            title={skill.name}
          >
            <SlashIcon aria-hidden="true" />
            <span className="truncate">{skill.name}</span>
            <span className="text-muted-foreground shrink-0">
              {unavailable
                ? "Unavailable"
                : skill.digest
                  ? `r${skill.revision}`
                  : "pending"}
            </span>
            {(skill.update_available || refreshing) && (
              <RefreshCwIcon aria-hidden="true" />
            )}
            <ChevronDownIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start">
          {(skill.update_available || refreshing) && (
            <DropdownMenuItem
              disabled={refreshing}
              onSelect={() =>
                update({
                  ...current,
                  refresh: [...new Set([...current.refresh, skill.id])],
                })
              }
            >
              <RefreshCwIcon />
              {refreshing ? "Refreshes on next send" : "Refresh on next send"}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={position === 0}
            onSelect={() => move(position, -1)}
          >
            <ArrowUpIcon />
            Move earlier
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={position === current.skills.length - 1}
            onSelect={() => move(position, 1)}
          >
            <ArrowDownIcon />
            Move later
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              update({
                ...current,
                skills: current.skills.filter((s) => s.id !== skill.id),
                refresh: current.refresh.filter((id) => id !== skill.id),
              })
            }
          >
            <XIcon />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  });
  const notices = (
    <div className="flex min-w-0 flex-col gap-2 empty:hidden">
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
    changePrompt(value, template) {
      update({
        ...current,
        prompt: value,
        literal: false,
        // A template label describes the current draft; clearing the draft drops it.
        template: value.trim() ? (template ?? current.template) : null,
      });
      setDismissed(false);
      setManual(false);
      setIndex(0);
    },
    prepare,
    accepted() {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {}
      setDraft({
        ...current,
        prompt: "",
        refresh: [],
        literal: false,
        template: null,
      });
    },
    template: current.template,
    changeTemplate(template) {
      update({ ...current, template });
    },
    hasSkills: current.skills.length > 0,
    ready: !!draft && !resolving,
    chips,
    notices,
    canOpenList: !disabled && !!draft,
    openList() {
      setManual(true);
      setDismissed(false);
    },
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
        if (!options.length) {
          setDismissed(true);
          return true;
        }
        choose(options[activeIndex]);
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
          aria-label={
            onOpenTemplate ? "Skills and templates" : "Eligible skills"
          }
          className="flex flex-col gap-1"
        >
          {query.isPending ? (
            <p role="status">Loading skills…</p>
          ) : query.isError ? (
            <EmptyState
              role="alert"
              title="Skills unavailable"
              description="Your message is kept; retry to load your assigned skills."
              action={
                <Button type="button" onClick={() => void query.refetch()}>
                  Retry skills
                </Button>
              }
            />
          ) : !query.data?.policy_enabled ? (
            <p>Skill activation is disabled by an administrator.</p>
          ) : !skillOptions.length && !templateOptions.length ? (
            <p>No matching assigned skills. Manage skills in User Settings.</p>
          ) : null}
          {options.map((option, i) => (
            <Button
              key={`${option.kind}:${option.kind === "skill" ? option.item.id : option.item.key}`}
              id={`${listId}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === activeIndex}
              variant={i === activeIndex ? "secondary" : "ghost"}
              className="h-auto min-h-11 justify-start text-left whitespace-normal"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(option)}
            >
              <span className="flex min-w-0 flex-col">
                <span className="break-all">
                  {option.kind === "skill"
                    ? `/${option.item.name}`
                    : option.item.label}
                </span>
                <span className="text-muted-foreground text-xs">
                  {option.item.description}
                </span>
              </span>
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
