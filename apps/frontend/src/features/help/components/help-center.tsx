"use client";

import { EmptyState } from "@/components/empty-state";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHelpAudience } from "@/features/help/components/help-audience";
import {
  helpAnchor,
  pageGuideAnchor,
  pageGuideLocation,
  searchHelp,
} from "@/features/help/center";
import type { PageGuide, PageGuideId } from "@/features/help/pages";
import {
  helpEntries,
  isVisibleTo,
  type HelpEntry,
  type HelpId,
} from "@/features/help/registry";
import { SearchIcon, SearchXIcon } from "lucide-react";
import Link from "next/link";
import React from "react";
import { flushSync } from "react-dom";

// A related link focuses its target entry; tabIndex -1 makes it focusable and
// the ring shows which entry the link landed on.
const anchorClassName =
  "rounded-surface focus:ring-ring/50 scroll-mt-4 p-3 -m-3 outline-none focus:ring-3";

type JumpTo = (anchor: string) => void;

/**
 * Every help entry and page guide the viewer may see, with client-side search
 * (US-61.5). Each entry and guide has a stable anchor, so "Open in help
 * center" links from popovers and the page help sheet land on it.
 */
export function HelpCenter() {
  const { isAdmin } = useHelpAudience();
  const [query, setQuery] = React.useState("");
  const deferredQuery = React.useDeferredValue(query);
  const results = searchHelp(deferredQuery, isAdmin);
  const total =
    results.concepts.length + results.controls.length + results.guides.length;
  // A link inside the page may target an entry the search hides. Clear the
  // search, then focus the entry once it renders: the router scrolls to a hash
  // but does not move focus, and the deferred results may lag a frame.
  const pendingFocus = React.useRef<string | null>(null);
  const focusPending = React.useCallback(() => {
    const target = pendingFocus.current
      ? document.getElementById(pendingFocus.current)
      : null;
    if (!target) return;
    pendingFocus.current = null;
    target.focus();
    target.scrollIntoView({ block: "start" });
  }, []);
  const jumpTo: JumpTo = (anchor) => {
    pendingFocus.current = anchor;
    flushSync(() => setQuery(""));
    requestAnimationFrame(focusPending);
  };
  React.useEffect(focusPending, [deferredQuery, focusPending]);
  const searching = deferredQuery.trim() !== "";

  return (
    <PageLayout>
      <PageHeader
        title="Help center"
        description="Every explanation in Asterism in one place: what each term means and what each page is for."
      />
      <search className="flex flex-col gap-2">
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="text-muted-foreground absolute top-1/2 left-2 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            aria-label="Search help"
            className="h-10 pl-8 text-sm"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search help, for example “persona” or “hints”"
            value={query}
          />
        </div>
        <p
          className="text-muted-foreground text-sm"
          aria-live="polite"
          aria-atomic="true"
        >
          {searching
            ? `${total} ${total === 1 ? "result" : "results"}`
            : `${total} topics`}
        </p>
      </search>
      {total === 0 ? (
        <EmptyState
          className="flex-none"
          icon={<SearchXIcon />}
          title="No help matches your search"
          description="Try a shorter or different word, or clear the search to browse every topic."
          action={
            <Button
              type="button"
              variant="outline"
              onClick={() => setQuery("")}
            >
              Clear search
            </Button>
          }
        />
      ) : (
        <>
          {!searching && <Contents />}
          <EntrySection
            id="concepts"
            title="Glossary"
            entries={results.concepts}
            isAdmin={isAdmin}
            jumpTo={jumpTo}
          />
          <EntrySection
            id="controls"
            title="Controls and settings"
            entries={results.controls}
            isAdmin={isAdmin}
            jumpTo={jumpTo}
          />
          {results.guides.length > 0 && (
            <section
              aria-labelledby="help-guides"
              className="flex flex-col gap-4"
            >
              <h2
                id="help-guides"
                tabIndex={-1}
                className="text-lg font-semibold outline-none"
              >
                Page guides
              </h2>
              <ul className="flex flex-col gap-6">
                {results.guides.map(([id, guide]) => (
                  <GuideItem
                    key={id}
                    id={id}
                    guide={guide}
                    isAdmin={isAdmin}
                    jumpTo={jumpTo}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </PageLayout>
  );
}

function Contents() {
  return (
    <nav aria-label="Help sections">
      <ul className="flex flex-wrap gap-2">
        {[
          ["concepts", "Glossary"],
          ["controls", "Controls and settings"],
          ["guides", "Page guides"],
        ].map(([anchor, label]) => (
          <li key={anchor}>
            <Button asChild variant="outline" size="sm">
              <Link href={`#help-${anchor}`}>{label}</Link>
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function EntrySection({
  id,
  title,
  entries,
  isAdmin,
  jumpTo,
}: {
  id: string;
  title: string;
  entries: [HelpId, HelpEntry][];
  isAdmin: boolean;
  jumpTo: JumpTo;
}) {
  if (entries.length === 0) return null;
  const headingId = `help-${id}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2
        id={headingId}
        tabIndex={-1}
        className="text-lg font-semibold outline-none"
      >
        {title}
      </h2>
      <ul className="flex flex-col gap-6">
        {entries.map(([entryId, entry]) => (
          <EntryItem
            key={entryId}
            id={entryId}
            entry={entry}
            isAdmin={isAdmin}
            jumpTo={jumpTo}
          />
        ))}
      </ul>
    </section>
  );
}

function EntryItem({
  id,
  entry,
  isAdmin,
  jumpTo,
}: {
  id: HelpId;
  entry: HelpEntry;
  isAdmin: boolean;
  jumpTo: JumpTo;
}) {
  const headingId = `${helpAnchor(id)}-title`;
  const related = entry.related.filter((relatedId) =>
    isVisibleTo(helpEntries[relatedId], isAdmin),
  );
  return (
    <li>
      <article
        id={helpAnchor(id)}
        tabIndex={-1}
        aria-labelledby={headingId}
        className={`flex flex-col gap-2 text-sm ${anchorClassName}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={headingId} className="text-base font-medium">
            {entry.title}
          </h3>
          {entry.audience === "admin" && (
            <Badge variant="secondary">Admins only</Badge>
          )}
        </div>
        <p>{entry.summary}</p>
        {entry.details.map((paragraph) => (
          <p key={paragraph} className="text-muted-foreground">
            {paragraph}
          </p>
        ))}
        <TermLinks label="Related" ids={related} jumpTo={jumpTo} />
      </article>
    </li>
  );
}

function GuideItem({
  id,
  guide,
  isAdmin,
  jumpTo,
}: {
  id: PageGuideId;
  guide: PageGuide;
  isAdmin: boolean;
  jumpTo: JumpTo;
}) {
  const headingId = `${pageGuideAnchor(id)}-title`;
  const location = pageGuideLocation(id);
  const terms = guide.terms.filter((termId) =>
    isVisibleTo(helpEntries[termId], isAdmin),
  );
  return (
    <li>
      <article
        id={pageGuideAnchor(id)}
        tabIndex={-1}
        aria-labelledby={headingId}
        className={`flex flex-col gap-3 text-sm ${anchorClassName}`}
      >
        <div className="flex flex-col gap-1">
          {location && (
            <p className="text-muted-foreground text-xs">{location}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={headingId} className="text-base font-medium">
              {guide.title}
            </h3>
            {guide.audience === "admin" && (
              <Badge variant="secondary">Admins only</Badge>
            )}
          </div>
          <p>{guide.purpose}</p>
        </div>
        {guide.areas.length > 0 && (
          <div>
            <h4 className="mb-1 font-medium">On this page</h4>
            <dl className="flex flex-col gap-1">
              {guide.areas.map((area) => (
                <div key={area.name}>
                  <dt className="font-medium">{area.name}</dt>
                  <dd className="text-muted-foreground">{area.description}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {guide.tasks.length > 0 && (
          <div>
            <h4 className="mb-1 font-medium">Tips</h4>
            <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5">
              {guide.tasks.map((task) => (
                <li key={task}>{task}</li>
              ))}
            </ul>
          </div>
        )}
        <TermLinks label="Terms used here" ids={terms} jumpTo={jumpTo} />
      </article>
    </li>
  );
}

function TermLinks({
  label,
  ids,
  jumpTo,
}: {
  label: string;
  ids: readonly HelpId[];
  jumpTo: JumpTo;
}) {
  if (ids.length === 0) return null;
  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      <p className="text-muted-foreground text-xs">{label}</p>
      <ul className="flex flex-wrap gap-1">
        {ids.map((termId) => (
          <li key={termId}>
            <Button asChild variant="outline" size="xs">
              <Link
                href={`#${helpAnchor(termId)}`}
                onClick={() => jumpTo(helpAnchor(termId))}
              >
                {helpEntries[termId].title}
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
