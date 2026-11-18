import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { DownloadMyData } from "./download-my-data";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  link: vi.fn(),
  assign: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  dataExportGetOptions: () => ({
    queryKey: ["data-export"],
    queryFn: mocks.get,
  }),
  dataExportCreateMutation: () => ({ mutationFn: mocks.create }),
  dataExportLinkCreateMutation: () => ({ mutationFn: mocks.link }),
}));

const ready = {
  id: "e1",
  status: "ready",
  requested_at: 1_795_000_000,
  completed_at: 1_795_000_060,
  expires_at: 1_795_604_860,
  size_bytes: 2 * 1024 * 1024,
};

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DownloadMyData />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("location", { ...window.location, assign: mocks.assign });
});

it("starts preparing an archive when there is none", async () => {
  mocks.get.mockResolvedValue({ export: null });
  mocks.create.mockResolvedValue({ ...ready, status: "pending" });
  const user = setup();
  await user.click(
    await screen.findByRole("button", { name: "Prepare my data" }),
  );
  expect(mocks.create).toHaveBeenCalled();
});

it("says the archive is being prepared and offers nothing to click", async () => {
  mocks.get.mockResolvedValue({ export: { ...ready, status: "running" } });
  setup();
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Preparing your data",
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("downloads a ready archive through a short-lived link", async () => {
  mocks.get.mockResolvedValue({ export: ready });
  mocks.link.mockResolvedValue({
    url: "/api/py/data-export/e1/archive?ticket=t",
    expires_at: 1,
  });
  const user = setup();
  expect(
    await screen.findByText(/Your archive is ready \(2\.0 MiB\)/),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Download" }));
  await waitFor(() =>
    expect(mocks.assign).toHaveBeenCalledWith(
      "/api/py/data-export/e1/archive?ticket=t",
    ),
  );
  expect(
    screen.getByRole("button", { name: "Prepare a new archive" }),
  ).toBeInTheDocument();
});

it("shows why preparing failed and lets the person try again", async () => {
  mocks.get.mockResolvedValue({
    export: {
      ...ready,
      status: "failed",
      error: "The archive could not be built.",
    },
  });
  setup();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The archive could not be built.",
  );
  expect(
    screen.getByRole("button", { name: "Prepare a new archive" }),
  ).toBeInTheDocument();
});
