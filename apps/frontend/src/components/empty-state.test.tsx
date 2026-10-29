import { render, screen } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";
import { EmptyState } from "./empty-state";

const SRC = join(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === "e2e" && dir.endsWith("app") ? [] : sources(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

it("renders a title, one sentence of guidance and the action", () => {
  render(
    <EmptyState
      title="No chats yet"
      description="Start a chat to see it here."
      action={<button>Start a chat</button>}
    />,
  );
  expect(screen.getByText("No chats yet")).toBeVisible();
  expect(screen.getByText("Start a chat to see it here.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Start a chat" })).toBeVisible();
});

it("routes every empty screen through EmptyState in one copy style", () => {
  const allowed = ["components/ui/empty.tsx", "components/empty-state.tsx"];
  const problems: string[] = [];
  for (const path of sources(SRC)) {
    const file = relative(SRC, path);
    if (allowed.includes(file)) continue;
    const text = readFileSync(path, "utf8");
    // QueryError composes the parts directly to keep its alert region.
    if (/<Empty[\s>]/.test(text) && file !== "components/query-error.tsx")
      problems.push(`${file}: use EmptyState instead of <Empty>`);
    for (const match of text.matchAll(/\btitle="([^"]+)"/g)) {
      if (!text.includes("<EmptyState")) break;
      const title = match[1];
      if (/\.$/.test(title)) problems.push(`${file}: "${title}" ends with "."`);
      // Sentence case: no capitalised word after the first, except "/" commands.
      if (/\s[A-Z][a-z]/.test(title.replace(/^\S+/, "")))
        problems.push(`${file}: "${title}" is not sentence case`);
    }
    for (const match of text.matchAll(/\bdescription="([^"]+)"/g)) {
      if (!text.includes("<EmptyState")) break;
      if (!/\.$/.test(match[1]))
        problems.push(`${file}: guidance "${match[1]}" is not a sentence`);
    }
  }
  expect(problems).toEqual([]);
});
