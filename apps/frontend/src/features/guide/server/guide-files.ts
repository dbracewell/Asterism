import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The user guide's files (US-90.9). `docs/guide` sits two levels above the
 * frontend: in the repository, and in the image, which copies it to
 * `/app/docs/guide`. Only files found by listing the folder are ever read, so
 * a request can't reach anything else.
 */
const GUIDE_ROOT = path.resolve(process.cwd(), "../../docs/guide");
const IMAGE_NAME = /^[a-z0-9][a-z0-9-]*\.png$/;
/** Kept for documentation writers; linked on GitHub instead. */
const HIDDEN = new Set(["CONTRIBUTING.md"]);

async function markdownFiles(dir = ""): Promise<string[]> {
  const entries = await readdir(path.join(GUIDE_ROOT, dir), {
    withFileTypes: true,
  });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relative = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory())
        return entry.name === "images" ? [] : markdownFiles(relative);
      return entry.name.endsWith(".md") && !HIDDEN.has(relative)
        ? [relative]
        : [];
    }),
  );
  return files.flat().sort();
}

/** Every guide page, as a path such as `02-chatting/canvas.md`. */
export function listGuidePages(): Promise<string[]> {
  return markdownFiles();
}

/** The page for a route's slug (none is the guide's README), or null. */
export async function readGuidePage(
  slug: readonly string[] = [],
): Promise<{ file: string; markdown: string } | null> {
  const file = slug.length === 0 ? "README.md" : `${slug.join("/")}.md`;
  if (!(await listGuidePages()).includes(file)) return null;
  return {
    file,
    markdown: await readFile(path.join(GUIDE_ROOT, file), "utf8"),
  };
}

/** A screenshot from `docs/guide/images`, or null. */
export async function readGuideImage(name: string): Promise<Buffer | null> {
  if (!IMAGE_NAME.test(name)) return null;
  const names = await readdir(path.join(GUIDE_ROOT, "images"));
  if (!names.includes(name)) return null;
  return readFile(path.join(GUIDE_ROOT, "images", name));
}
