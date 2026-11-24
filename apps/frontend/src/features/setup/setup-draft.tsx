"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

/** An Admin Settings form's unsaved edits, as the setup walkthrough sees them. */
export interface SetupDraft {
  /** The form holds edits that are not saved. */
  dirty: boolean;
  /** Saves the edits; rejects when they could not be saved. */
  save: () => Promise<unknown>;
  /** Why the edits can't be saved yet, when they can't. */
  blocked?: string;
}

interface Registry {
  report: (id: string, draft: SetupDraft | null) => void;
}

const SetupDraftContext = createContext<Registry | null>(null);

/**
 * Tells the setup walkthrough (US-102.3) about this form's unsaved edits, so
 * Next can save them and Skip can ask before discarding them. Outside the
 * walkthrough it does nothing.
 */
export function useSetupDraft({ dirty, save, blocked }: SetupDraft) {
  const registry = useContext(SetupDraftContext);
  const id = useId();
  useEffect(() => {
    registry?.report(id, dirty ? { dirty, save, blocked } : null);
  }, [registry, id, dirty, save, blocked]);
  useEffect(() => () => registry?.report(id, null), [registry, id]);
}

/**
 * The walkthrough's side: which forms of the current step hold edits, and a
 * way to save them all. Only the flags are state, so a form re-rendering with
 * a new save function doesn't re-render the walkthrough.
 */
export function useSetupDrafts() {
  const saves = useRef(new Map<string, () => Promise<unknown>>());
  // Form id → why its edits can't be saved ("" when they can).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const registry = useMemo<Registry>(
    () => ({
      report(id, draft) {
        if (draft) saves.current.set(id, draft.save);
        else saves.current.delete(id);
        const value = draft ? (draft.blocked ?? "") : undefined;
        setDrafts((previous) => {
          if (previous[id] === value) return previous;
          const next = { ...previous };
          if (value === undefined) delete next[id];
          else next[id] = value;
          return next;
        });
      },
    }),
    [],
  );
  const reasons = Object.values(drafts);
  return {
    registry,
    dirty: reasons.length > 0,
    blocked: reasons.find(Boolean),
    /** Saves every form in turn; stops at the first that fails. */
    async saveAll() {
      for (const save of [...saves.current.values()]) await save();
    },
  };
}

export function SetupDraftProvider({
  registry,
  children,
}: {
  registry: Registry;
  children: ReactNode;
}) {
  return (
    <SetupDraftContext.Provider value={registry}>
      {children}
    </SetupDraftContext.Provider>
  );
}
