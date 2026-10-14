import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FolderPage } from "./folder-page";

vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({ folderGetOneOptions: () => ({}) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: { title: "Research" } }) }));

it("renders folder metadata without obsolete folder chat controls", () => {
  render(<FolderPage folderId="folder-1" />);
  expect(screen.getByRole("heading", { name: "Research" })).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
