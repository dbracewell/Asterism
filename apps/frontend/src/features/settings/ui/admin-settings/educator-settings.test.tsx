import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { EducatorSettings } from "./educator-settings";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  approve: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  educatorRequestGetManyOptions: () => ({
    queryKey: ["requests"],
    queryFn: mocks.list,
  }),
  educatorRequestApproveMutation: () => ({ mutationFn: mocks.approve }),
  educatorRequestDeleteMutation: () => ({ mutationFn: mocks.remove }),
}));

const row = (name: string, status: string) => ({
  user_id: name,
  display_name: name,
  email: `${name}@example.test`,
  status,
  created_at: 1,
});

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EducatorSettings />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({
    items: [row("Ann", "pending"), row("Bo", "approved")],
    total: 2,
    page: 1,
    page_size: 100,
  });
});

it("approves or denies a waiting request", async () => {
  const user = setup();
  expect(await screen.findByText("Ann@example.test")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Approve Ann" }));
  await waitFor(() =>
    expect(mocks.approve.mock.calls[0][0]).toEqual({
      path: { user_id: "Ann" },
    }),
  );
  await user.click(screen.getByRole("button", { name: "Deny Ann" }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalled());
});

it("leaves out the email line when no email is stored", async () => {
  mocks.list.mockResolvedValue({
    items: [{ ...row("Ann", "pending"), email: null }],
    total: 1,
    page: 1,
    page_size: 100,
  });
  setup();
  const name = await screen.findByText("Ann");
  expect(name.parentElement?.children).toHaveLength(1);
});

it("revokes an educator, who cannot be approved twice", async () => {
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Revoke Bo" }));
  await waitFor(() =>
    expect(mocks.remove.mock.calls[0][0]).toEqual({ path: { user_id: "Bo" } }),
  );
  expect(
    screen.queryByRole("button", { name: "Approve Bo" }),
  ).not.toBeInTheDocument();
});

it("explains where requests come from when there are none", async () => {
  mocks.list.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 100,
  });
  setup();
  expect(await screen.findByText(/from the Classes page/)).toBeInTheDocument();
});
