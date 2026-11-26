// Prepares mermaid source before it is drawn (EPIC-108). The app's markdown
// viewer imports it, and the server's export renderer loads this file into its
// headless page as an inline module, so both draw the same source. Plain
// JavaScript with no imports: it runs unbundled in that page.
//
// Models often put the accessibility lines (`accTitle:`, `accDescr:`) above the
// diagram type, where mermaid refuses the whole diagram, and some diagram
// types refuse them anywhere. This only moves or drops those lines; every
// other line, and so everything a diagram may do, is unchanged.

/**
 * @typedef {{
 *   source: string,
 *   title: string | null,
 *   description: string | null,
 * }} PreparedDiagram
 */

// Diagram types whose grammar has no accessibility statements.
const WITHOUT_ACCESSIBILITY = new Set(["mindmap"]);

const TITLE = /^\s*accTitle\s*:\s*(.*)$/;
const DESCRIPTION = /^\s*accDescr\s*:\s*(.*)$/;
const DESCRIPTION_BLOCK = /^\s*accDescr\s*\{(.*)$/;

/**
 * Splits the source into accessibility statements and everything else.
 *
 * @param {string[]} lines
 * @returns {{ statements: { start: number, end: number }[], title: string | null, description: string | null }}
 */
function findStatements(lines) {
  const statements = [];
  let title = null;
  let description = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const titled = TITLE.exec(line);
    if (titled) {
      title ??= titled[1].trim() || null;
      statements.push({ start: index, end: index });
      continue;
    }
    const described = DESCRIPTION.exec(line);
    if (described) {
      description ??= described[1].trim() || null;
      statements.push({ start: index, end: index });
      continue;
    }
    const block = DESCRIPTION_BLOCK.exec(line);
    if (block) {
      // `accDescr {` … `}`, possibly closed on the same line.
      let end = index;
      const parts = [block[1]];
      while (!parts.at(-1).includes("}") && end + 1 < lines.length) {
        end += 1;
        parts.push(lines[end]);
      }
      const text = parts.join("\n").replace(/\}[^}]*$/, "");
      description ??= text.replace(/\s+/g, " ").trim() || null;
      statements.push({ start: index, end });
      index = end;
    }
  }
  return { statements, title, description };
}

/**
 * The index of the line naming the diagram type: the first line that is not
 * blank, a `%%` comment, front matter or an accessibility statement.
 *
 * @param {string[]} lines
 * @param {Set<number>} statementLines
 */
function typeLine(lines, statementLines) {
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index++;
  if (lines[index]?.trim() === "---") {
    index++;
    while (index < lines.length && lines[index].trim() !== "---") index++;
    index++;
  }
  for (; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || line.startsWith("%%") || statementLines.has(index)) continue;
    return index;
  }
  return -1;
}

/**
 * Puts accessibility statements where mermaid accepts them.
 *
 * @param {string} source Untrusted mermaid source.
 * @returns {PreparedDiagram}
 */
export function prepareDiagramSource(source) {
  const lines = source.split("\n");
  const { statements, title, description } = findStatements(lines);
  const unchanged = { source, title, description };
  if (!statements.length) return unchanged;
  const statementLines = new Set(
    statements.flatMap(({ start, end }) =>
      Array.from({ length: end - start + 1 }, (_, offset) => start + offset),
    ),
  );
  const type = typeLine(lines, statementLines);
  if (type < 0) return unchanged;
  const kind = lines[type].trim().split(/\s+/)[0];
  const dropAll = WITHOUT_ACCESSIBILITY.has(kind);
  const moved = [];
  const kept = [];
  let typeAt = -1;
  lines.forEach((line, index) => {
    if (index === type) typeAt = kept.length;
    if (!statementLines.has(index)) kept.push(line);
    else if (dropAll) return;
    else if (index < type) moved.push(line);
    else kept.push(line);
  });
  if (!dropAll && !moved.length) return unchanged;
  kept.splice(typeAt + 1, 0, ...moved);
  return { source: kept.join("\n"), title, description };
}
