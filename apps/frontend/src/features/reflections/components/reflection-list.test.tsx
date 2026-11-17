import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { handleMutationSuccess } from "@/lib/mutation-cache";
import { ReflectionList } from "./reflection-list";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ id: "owner" }),
}));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  reflectionGetManyOptions: ({ query }: { query: object }) => ({
    queryKey: [{ _id: "reflectionGetMany", query }],
    queryFn: () => mocks.list(query),
  }),
  reflectionGetManyQueryKey: () => [{ _id: "reflectionGetMany" }],
  reflectionUpdateMutation: () => ({ mutationFn: mocks.update }),
  reflectionDeleteMutation: () => ({ mutationFn: mocks.remove }),
}));

const reflection = {
  id: "r1",
  project_id: "proj",
  chat_id: "c1",
  learned: "Osmosis moves water.",
  unclear: "Tonicity",
  revision: 2,
  created_at: 1_700_000_000,
  updated_at: 1_700_000_000,
};

let cache: QueryClient;
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={cache}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.list.mockResolvedValue({
    items: [reflection],
    total: 1,
    page: 1,
    page_size: 10,
  });
  mocks.update.mockResolvedValue({ ...reflection, revision: 3 });
  mocks.remove.mockResolvedValue(undefined);
  cache = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_d, _v, _c, mutation) =>
        handleMutationSuccess(cache, mutation),
    }),
    defaultOptions: { queries: { retry: false } },
  });
});

it("lists the project's reflections", async () => {
  render(<ReflectionList projectId="proj" />, { wrapper: Wrapper });
  const item = await screen.findByRole("listitem", {
    name: /Reflection from/,
  });
  expect(
    screen.getByRole("button", { name: "Help: Reflection" }),
  ).toBeInTheDocument();
  expect(item).toHaveTextContent("What did I learn?Osmosis moves water.");
  expect(within(item).getByRole("link", { name: "Open chat" })).toHaveAttribute(
    "href",
    "/chat/c1",
  );
  expect(mocks.list).toHaveBeenCalledWith({
    project_id: "proj",
    page: 1,
    page_size: 10,
  });
  expect(
    screen.queryByRole("combobox", { name: "Persona" }),
  ).not.toBeInTheDocument();
});

it("edits and deletes with the loaded revision", async () => {
  const user = userEvent.setup();
  render(<ReflectionList projectId={null} />, { wrapper: Wrapper });
  const item = await screen.findByRole("listitem", {
    name: /Reflection from/,
  });
  expect(mocks.list).toHaveBeenCalledWith({ page: 1, page_size: 10 });
  await user.click(within(item).getByRole("button", { name: "Edit" }));
  const unclear = within(item).getByLabelText("What's still unclear?");
  await user.clear(unclear);
  await user.type(unclear, "Nothing now");
  await user.click(within(item).getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalled());
  expect(mocks.update.mock.calls[0][0]).toEqual({
    path: { reflection_id: "r1" },
    body: {
      learned: "Osmosis moves water.",
      unclear: "Nothing now",
      expected_revision: 2,
    },
  });
  await user.click(await within(item).findByRole("button", { name: "Delete" }));
  await user.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Delete reflection",
    }),
  );
  await waitFor(() =>
    expect(mocks.remove.mock.calls[0][0]).toEqual({
      path: { reflection_id: "r1" },
      query: { expected_revision: 2 },
    }),
  );
});

it("links unclear items to the project's Progress panel", async () => {
  render(<ReflectionList projectId="proj" />, { wrapper: Wrapper });
  const item = await screen.findByRole("listitem", {
    name: /Reflection from/,
  });
  expect(
    within(item).getByRole("link", { name: "Practice in Progress" }),
  ).toHaveAttribute("href", "/projects/proj?tab=study#progress");
});

it.each([
  ["General", { project_id: null }],
  ["nothing unclear", { unclear: "" }],
])("hides unclear-item practice for %s", async (_name, overrides) => {
  mocks.list.mockResolvedValue({
    items: [{ ...reflection, ...overrides }],
    total: 1,
    page: 1,
    page_size: 10,
  });
  render(<ReflectionList projectId="proj" />, { wrapper: Wrapper });
  const item = await screen.findByRole("listitem", {
    name: /Reflection from/,
  });
  expect(
    within(item).queryByRole("link", { name: "Practice in Progress" }),
  ).toBeNull();
});
