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
import type { Reflection } from "@/lib/client";
import { UnclearPracticeDialog } from "./unclear-practice-dialog";

const mocks = vi.hoisted(() => ({ decks: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  studyDeckGetManyOptions: () => ({
    queryKey: [{ _id: "studyDeckGetMany" }],
    queryFn: mocks.decks,
  }),
  studyUnclearCardCreateMutation: () => ({ mutationFn: mocks.create }),
}));

const reflection: Reflection = {
  id: "r1",
  persona_id: "p1",
  project_id: "proj",
  chat_id: "c1",
  learned: "",
  unclear: "- Tonicity\n- Why cells burst",
  revision: 1,
  created_at: 1,
  updated_at: 1,
};

let cache: QueryClient;
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={cache}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.decks.mockResolvedValue({
    items: [
      { id: "d1", name: "Biology" },
      { id: "d2", name: "Unclear items" },
    ],
    total: 2,
    page: 1,
    page_size: 100,
  });
  mocks.create.mockResolvedValue({ id: "card" });
  cache = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_d, _v, _c, mutation) =>
        handleMutationSuccess(cache, mutation),
    }),
    defaultOptions: { queries: { retry: false } },
  });
});

function open() {
  render(
    <UnclearPracticeDialog
      reflection={reflection}
      projectId="proj"
      open
      onOpenChange={() => {}}
    />,
    { wrapper: Wrapper },
  );
  return screen.getByRole("dialog", { name: "Practice what's unclear" });
}

it("adds only the item the learner confirms, with their wording", async () => {
  const user = userEvent.setup();
  const dialog = open();
  const first = within(dialog).getByRole("listitem", { name: "Item 1" });
  const second = within(dialog).getByRole("listitem", { name: "Item 2" });
  expect(within(first).getByLabelText("Question")).toHaveValue("Tonicity");
  const add = within(first).getByRole("button", { name: "Add card" });
  // A card needs an answer, so nothing is added from the prefilled text alone.
  expect(add).toBeDisabled();
  const question = within(first).getByLabelText("Question");
  await user.clear(question);
  await user.type(question, "What is tonicity?");
  await user.type(
    within(first).getByLabelText("Answer"),
    "Relative solute concentration",
  );
  await user.click(add);
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  expect(mocks.create.mock.calls[0][0]).toEqual({
    path: { project_id: "proj" },
    body: {
      reflection_id: "r1",
      deck_id: null,
      front: "What is tonicity?",
      back: "Relative solute concentration",
      weak_spot: true,
    },
  });
  expect(await within(first).findByRole("status")).toHaveTextContent(
    "Card added: What is tonicity?",
  );
  // The other item is untouched and still needs its own confirmation.
  expect(within(second).getByLabelText("Question")).toHaveValue(
    "Why cells burst",
  );
});

it("can use a chosen deck, skip weak spots, and show a repeat", async () => {
  mocks.create.mockRejectedValueOnce({ detail: "This item is already a card" });
  const user = userEvent.setup();
  const dialog = open();
  await user.click(
    within(dialog).getByRole("combobox", { name: "Add cards to" }),
  );
  expect(
    screen.queryByRole("option", { name: "Unclear items" }),
  ).not.toBeInTheDocument();
  await user.click(await screen.findByRole("option", { name: "Biology" }));
  const first = within(dialog).getByRole("listitem", { name: "Item 1" });
  await user.type(within(first).getByLabelText("Answer"), "Look in chapter 3");
  await user.click(
    within(first).getByRole("checkbox", { name: "Also add to weak spots" }),
  );
  await user.click(within(first).getByRole("button", { name: "Add card" }));
  expect(await within(first).findByRole("alert")).toHaveTextContent(
    "This item is already a card",
  );
  expect(mocks.create.mock.calls[0][0].body).toMatchObject({
    deck_id: "d1",
    weak_spot: false,
  });
});
