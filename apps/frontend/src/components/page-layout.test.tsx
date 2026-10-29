import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { PageHeader, PageLayout } from "./page-layout";

const SRC = join(__dirname, "..");

it("renders one titled header with description and actions in a main landmark", () => {
  render(
    <PageLayout>
      <PageHeader
        title="Projects"
        description="Keep related work together."
        actions={<button>New project</button>}
      />
    </PageLayout>,
  );
  const main = screen.getByRole("main");
  expect(main).toHaveAttribute("data-page-layout");
  expect(
    screen.getByRole("heading", { level: 1, name: "Projects" }),
  ).toBeVisible();
  expect(screen.getByText("Keep related work together.")).toBeVisible();
  expect(screen.getByRole("button", { name: "New project" })).toBeVisible();
});

it("omits the description and action slots when they are not provided", () => {
  const { container } = render(<PageHeader title="Search" />);
  expect(container.querySelector("p")).toBeNull();
  expect(container.querySelector("header")?.children).toHaveLength(1);
});

it("keeps the title before the actions in reading and keyboard order", () => {
  render(<PageHeader title="Files" actions={<button>Upload</button>} />);
  const heading = screen.getByRole("heading", { level: 1 });
  const action = screen.getByRole("button", { name: "Upload" });
  expect(
    heading.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it.each([
  "app/(main)/general/page.tsx",
  "app/(main)/files/page.tsx",
  "features/projects/components/project-list.tsx",
  "features/chat/components/chat-search.tsx",
])("%s uses the shared page layout and header", (path) => {
  const source = readFileSync(join(SRC, path), "utf8");
  expect(source).toContain("<PageLayout");
  expect(source).toContain("<PageHeader");
  expect(source).not.toMatch(/<h1\b/);
});
