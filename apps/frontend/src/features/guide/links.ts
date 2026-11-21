/**
 * Links and images inside the user guide (US-90.9).
 *
 * The guide's Markdown in `docs/guide/` uses relative links so it reads on
 * GitHub. In the app, a link to another guide page becomes a route under
 * `/help/guide`, a screenshot is served from `/help/guide/images`, and a link
 * that leaves the guide (the deployment guide, scripts) goes to the repository.
 */
export const GUIDE_ROUTE = "/help/guide";
export const REPOSITORY_URL = "https://github.com/dbracewell/Asterism";

/** Guide pages kept for documentation writers; they stay on GitHub. */
const REPOSITORY_ONLY = new Set(["CONTRIBUTING.md"]);

export type GuideLink =
  { kind: "internal"; href: string } | { kind: "external"; href: string };

/** The route for a guide page path such as `02-chatting/canvas.md`. */
export function guidePageRoute(file: string): string {
  const page = file.replace(/\.md$/, "");
  return page === "README" ? GUIDE_ROUTE : `${GUIDE_ROUTE}/${page}`;
}

function repositoryUrl(fromRoot: string, isDirectory: boolean): string {
  return `${REPOSITORY_URL}/${isDirectory ? "tree" : "blob"}/main/${fromRoot}`;
}

/** Join and normalize POSIX paths; a leading "../" means above the start. */
function resolvePath(base: string, target: string): string {
  const parts: string[] = [];
  for (const part of `${base}/${target}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts[parts.length - 1] !== "..")
      parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

const dirname = (file: string) =>
  file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";

/**
 * Where a link in guide page `current` (e.g. `02-chatting/canvas.md`) leads.
 * Returns null for a link that should stay as written (an anchor on the page).
 */
export function resolveGuideHref(
  current: string,
  href: string,
): GuideLink | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: "external", href };
  if (href.startsWith("#")) return null;
  const [target, hash] = href.split("#", 2);
  const anchor = hash ? `#${hash}` : "";
  const isDirectory = target.endsWith("/");
  // Relative to the guide's root; "../" at the start means it left the guide.
  const resolved = resolvePath(dirname(current), target);
  if (resolved.startsWith("../") || resolved === "..") {
    const fromRoot = resolvePath("docs/guide", resolved);
    return {
      kind: "external",
      href: repositoryUrl(fromRoot, isDirectory) + anchor,
    };
  }
  if (resolved.startsWith("images/"))
    return { kind: "internal", href: `${GUIDE_ROUTE}/${resolved}` };
  if (resolved.endsWith(".md") && !REPOSITORY_ONLY.has(resolved))
    return { kind: "internal", href: guidePageRoute(resolved) + anchor };
  return {
    kind: "external",
    href:
      repositoryUrl(resolvePath("docs/guide", resolved), isDirectory) + anchor,
  };
}

/** GitHub's heading slug, as `pnpm docs:check` computes it. */
export function slugify(heading: string): string {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*`]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** The route for a page guide's `walkthrough` (see PageGuide). */
export function walkthroughHref(walkthrough: string): string {
  const [page, anchor] = walkthrough.split("#", 2);
  return guidePageRoute(`${page}.md`) + (anchor ? `#${anchor}` : "");
}
