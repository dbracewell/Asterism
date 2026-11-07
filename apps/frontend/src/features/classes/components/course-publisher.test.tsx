import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { CoursePublisher } from "./course-publisher";

const mocks = vi.hoisted(() => ({ publish: vi.fn(), versions: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  projectGetManyOptions: () => ({
    queryKey: ["projects"],
    queryFn: async () => ({
      projects: [{ id: "p1", name: "Bio setup" }],
      total: 1,
      page: 1,
      page_size: 100,
    }),
  }),
  classCourseVersionGetManyOptions: () => ({
    queryKey: ["versions"],
    queryFn: mocks.versions,
  }),
  classCoursePublishMutation: () => ({ mutationFn: mocks.publish }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.versions.mockResolvedValue({
    items: [
      {
        id: "v1",
        number: 1,
        note: "Week one",
        created_at: 1_700_000_000,
        sub_agent_names: ["Tutor"],
        file_names: ["notes.txt"],
      },
    ],
    total: 1,
    page: 1,
    page_size: 20,
  });
});

it("publishes the chosen project as the next version", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CoursePublisher classId="c1" />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  expect(
    await screen.findByText("1 sub-agent (Tutor), 1 file"),
  ).toBeInTheDocument();
  const publish = screen.getByRole("button", { name: "Publish version 2" });
  expect(publish).toBeDisabled();
  await user.click(
    screen.getByRole("combobox", { name: "Project to publish" }),
  );
  await user.click(await screen.findByRole("option", { name: "Bio setup" }));
  await user.type(screen.getByLabelText("What's new (optional)"), "Week two");
  await user.click(publish);
  await waitFor(() =>
    expect(mocks.publish.mock.calls[0]?.[0]).toEqual({
      path: { class_id: "c1" },
      body: { project_id: "p1", note: "Week two" },
    }),
  );
});
