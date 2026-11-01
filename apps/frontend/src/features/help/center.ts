/**
 * The help center (US-61.5, ADR-0032): anchors, links and search over the
 * help registry and the page guides. Every help link in the app is built here
 * so a link and the entry it lands on cannot drift apart.
 */
import { pageGuides, type PageGuide, type PageGuideId } from "./pages";
import {
  helpEntries,
  isVisibleTo,
  type HelpEntry,
  type HelpId,
} from "./registry";

export const HELP_CENTER_PATH = "/help";

/** Glossary anchors are the help ID itself, for example `concept.persona`. */
export function helpAnchor(id: HelpId): string {
  return id;
}

/** Page guide anchors are prefixed: guide IDs such as `admin.tools` overlap help IDs. */
export function pageGuideAnchor(id: PageGuideId): string {
  return `page-${id}`;
}

export function helpCenterHref(id: HelpId): string {
  return `${HELP_CENTER_PATH}#${helpAnchor(id)}`;
}

export function pageGuideHref(id: PageGuideId): string {
  return `${HELP_CENTER_PATH}#${pageGuideAnchor(id)}`;
}

function terms(query: string): string[] {
  return query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

/** True when every word of the query appears somewhere in the texts. */
function matches(texts: readonly string[], words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const haystack = texts.join("\n").toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}

function entryText(entry: HelpEntry): string[] {
  return [entry.title, entry.summary, ...entry.details];
}

function guideText(guide: PageGuide): string[] {
  return [
    guide.title,
    guide.purpose,
    ...guide.areas.flatMap((area) => [area.name, area.description]),
    ...guide.tasks,
    ...guide.terms.map((id) => helpEntries[id].title),
  ];
}

const byTitle = <T extends { title: string }>(
  [, a]: [unknown, T],
  [, b]: [unknown, T],
) => a.title.localeCompare(b.title);

export interface HelpCenterResults {
  concepts: [HelpId, HelpEntry][];
  controls: [HelpId, HelpEntry][];
  guides: [PageGuideId, PageGuide][];
}

/**
 * The entries and guides visible to the viewer that match the query. Entries
 * sort by title; guides keep their registry order, which follows the app's
 * navigation. Glossary concepts (`concept.*`) are split from help about a single
 * control or setting.
 */
export function searchHelp(query: string, isAdmin: boolean): HelpCenterResults {
  const words = terms(query);
  const entries = (Object.entries(helpEntries) as [HelpId, HelpEntry][])
    .filter(([, entry]) => isVisibleTo(entry, isAdmin))
    .filter(([, entry]) => matches(entryText(entry), words))
    .sort(byTitle);
  const guides = (Object.entries(pageGuides) as [PageGuideId, PageGuide][])
    .filter(([, guide]) => isVisibleTo(guide, isAdmin))
    .filter(([, guide]) => matches(guideText(guide), words));
  return {
    concepts: entries.filter(([id]) => id.startsWith("concept.")),
    controls: entries.filter(([id]) => !id.startsWith("concept.")),
    guides,
  };
}

/** Where a guide's page lives, for guides whose title alone is ambiguous. */
export function pageGuideLocation(id: PageGuideId): string | null {
  if (id.startsWith("settings.")) return "User Settings";
  if (id.startsWith("admin.")) return "Admin Settings";
  return null;
}
