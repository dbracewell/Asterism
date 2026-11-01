"use client";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useHelpAudience } from "@/features/help/components/help-audience";
import {
  pageGuideFor,
  pageGuides,
  type PageGuide,
} from "@/features/help/pages";
import {
  helpEntries,
  isVisibleTo,
  type HelpId,
} from "@/features/help/registry";
import { BookOpenTextIcon, ChevronDownIcon } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import React from "react";

/** Text entry and choice widgets keep `?` as typed input. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest("input, textarea, select")) return true;
  return !!target.closest(
    '[role="textbox"], [role="combobox"], [role="listbox"], [role="menu"], [role="dialog"], [role="alertdialog"]',
  );
}

/**
 * The header's "Help" button and side sheet for the current page (US-61.3).
 * `?` opens it when focus is not in a text field or another overlay.
 */
export function PageHelp() {
  const pathname = usePathname();
  const search = useSearchParams();
  const { isAdmin } = useHelpAudience();
  const [open, setOpen] = React.useState(false);
  const guideId = pageGuideFor(
    pathname,
    { t: search.get("t"), setting: search.get("setting") },
    isAdmin,
  );
  const guide = guideId ? pageGuides[guideId] : null;
  const available = !!guide && isVisibleTo(guide, isAdmin);

  React.useEffect(() => {
    if (!available) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [available]);

  if (!guide || !available) return null;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-11 shrink-0 md:size-9"
          aria-label="Help for this page"
          aria-keyshortcuts="?"
          title="Help for this page (?)"
        >
          <BookOpenTextIcon aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full max-w-full gap-0 overflow-y-auto sm:max-w-md">
        <PageGuideView guide={guide} isAdmin={isAdmin} />
      </SheetContent>
    </Sheet>
  );
}

function PageGuideView({
  guide,
  isAdmin,
}: {
  guide: PageGuide;
  isAdmin: boolean;
}) {
  const terms = guide.terms.filter((id) =>
    isVisibleTo(helpEntries[id], isAdmin),
  );
  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle className="text-base">Help: {guide.title}</SheetTitle>
        <SheetDescription className="text-sm">{guide.purpose}</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-5 px-4 pb-6 text-sm">
        {guide.areas.length > 0 && (
          <section aria-labelledby="page-help-areas">
            <h3 id="page-help-areas" className="mb-2 font-medium">
              On this page
            </h3>
            <dl className="flex flex-col gap-2">
              {guide.areas.map((area) => (
                <div key={area.name}>
                  <dt className="font-medium">{area.name}</dt>
                  <dd className="text-muted-foreground">{area.description}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {guide.tasks.length > 0 && (
          <section aria-labelledby="page-help-tasks">
            <h3 id="page-help-tasks" className="mb-2 font-medium">
              Tips
            </h3>
            <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5">
              {guide.tasks.map((task) => (
                <li key={task}>{task}</li>
              ))}
            </ul>
          </section>
        )}
        {terms.length > 0 && (
          <section aria-labelledby="page-help-terms">
            <h3 id="page-help-terms" className="mb-2 font-medium">
              Terms used here
            </h3>
            <ul className="flex flex-col gap-3">
              {terms.map((id) => (
                <TermItem key={id} id={id} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

function TermItem({ id }: { id: HelpId }) {
  const entry = helpEntries[id];
  return (
    <li>
      <Collapsible>
        <h4 className="font-medium">{entry.title}</h4>
        <p className="text-muted-foreground">{entry.summary}</p>
        {entry.details.length > 0 && (
          <>
            <CollapsibleContent className="text-muted-foreground mt-1 flex flex-col gap-1">
              {entry.details.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </CollapsibleContent>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="group px-0"
                aria-label={`Learn more about ${entry.title}`}
              >
                Learn more
                <ChevronDownIcon
                  aria-hidden="true"
                  className="transition-transform group-aria-expanded:rotate-180"
                />
              </Button>
            </CollapsibleTrigger>
          </>
        )}
      </Collapsible>
    </li>
  );
}
