import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { UsedMemories } from "./used-memories";

vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  memoryGetOneOptions: ({ path }: { path: { memory_id: string } }) => ({
    queryKey: [{ _id: "memoryGetOne", path }],
    queryFn: async () => {
      if (path.memory_id === "gone") throw { detail: "Memory not found" };
      return {
        id: path.memory_id,
        kind: path.memory_id === "p" ? "project" : "user",
        project_id: path.memory_id === "p" ? "proj" : null,
        text: path.memory_id === "p" ? "APA citations" : "Prefers diagrams",
        revision: 2,
      };
    },
  }),
}));

function show(memories: { id: string; revision: number }[], enabled = true) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <UsedMemories memories={memories} enabled={enabled} />
    </QueryClientProvider>,
  );
}

it("lists the memories a reply used, linked to where they're managed", async () => {
  show([
    { id: "u", revision: 2 },
    { id: "p", revision: 1 },
    { id: "gone", revision: 1 },
  ]);
  const yours = await screen.findByRole("link", { name: "Prefers diagrams" });
  expect(yours).toHaveAttribute(
    "href",
    "/settings?t=user&setting=your-asterism&memory=u",
  );
  const project = await screen.findByRole("link", { name: "APA citations" });
  expect(project).toHaveAttribute(
    "href",
    "/projects/proj?tab=settings&memory=p",
  );
  expect(project.parentElement).toHaveTextContent("(edited since)");
  expect(
    await screen.findByText("A memory you've deleted since"),
  ).toBeInTheDocument();
});

it("shows nothing for a reply that used no memories", () => {
  show([]);
  expect(screen.queryByRole("region", { name: "Memories" })).toBeNull();
});
