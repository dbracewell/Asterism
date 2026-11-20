import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { InstanceStatus } from "@/lib/client";
import { StatusSettings } from "./status-settings";

const mocks = vi.hoisted(() => ({ status: vi.fn(), ready: vi.fn() }));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  statusGetOptions: () => ({ queryKey: ["status"], queryFn: mocks.status }),
  healthReadyOptions: () => ({ queryKey: ["ready"], queryFn: mocks.ready }),
}));

const NOW = 1_795_000_000;

function status(over: Partial<InstanceStatus> = {}): InstanceStatus {
  return {
    version: "0.2.0",
    commit: "0123456789abcdef0123456789abcdef01234567",
    schema_revision: "ba46812696ea",
    started_at: NOW - 90_000,
    uptime_seconds: 90_000,
    log_level: "INFO",
    log_format: "json",
    active_chat_runs: { used: 3, limit: 12 },
    chat_connections: { used: 20, limit: 40 },
    knowledge_running: 2,
    knowledge_queued: 5,
    storage: {
      used_bytes: 5 * 1024 ** 3,
      free_bytes: 40 * 1024 ** 3,
      total_bytes: 100 * 1024 ** 3,
      min_free_bytes: 1024 ** 3,
    },
    last_backup: {
      created_at: NOW - 3600,
      archive: "asterism-backup-20261118T020000Z.tar.gz",
      size_bytes: 300 * 1024 ** 2,
    },
    ...over,
  };
}

function setup() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <StatusSettings />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.mockResolvedValue(status());
  mocks.ready.mockResolvedValue({ ready: true, checks: [] });
});

it("shows readiness, uptime, work against limits, storage and the last backup", async () => {
  setup();
  expect(await screen.findByText("Ready")).toBeInTheDocument();
  expect(screen.getByText("0.2.0")).toBeInTheDocument();
  expect(screen.getByText("0123456789ab")).toHaveAttribute(
    "title",
    "0123456789abcdef0123456789abcdef01234567",
  );
  expect(screen.getByText("1 d 1 h")).toBeInTheDocument();
  expect(screen.getByText("INFO, json")).toBeInTheDocument();
  expect(
    screen.getByRole("progressbar", {
      name: "Replies running: 25% of the limit",
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("File processing: 2 running, 5 waiting."),
  ).toBeInTheDocument();
  expect(screen.getByText("40.0 GiB of 100.0 GiB")).toBeInTheDocument();
  const backup = screen.getByText(/Last backup/);
  expect(backup).toHaveTextContent(
    "asterism-backup-20261118T020000Z.tar.gz (300.0 MiB)",
  );
  expect(backup).not.toHaveClass("text-destructive");
});

it("names failed readiness checks and flags a stale or missing backup", async () => {
  mocks.ready.mockRejectedValue({
    ready: false,
    checks: [
      { name: "database", ok: true, detail: "" },
      {
        name: "storage",
        ok: false,
        detail: "Storage free space is below the minimum",
      },
    ],
  });
  mocks.status.mockResolvedValue(
    status({
      last_backup: {
        created_at: NOW - 3 * 86_400,
        archive: "old.tar.gz",
        size_bytes: 1,
      },
    }),
  );
  setup();
  expect(await screen.findByText("Not ready")).toBeInTheDocument();
  expect(
    within(screen.getByRole("alert")).getByText(/below the minimum/),
  ).toBeInTheDocument();
  expect(screen.getByText(/more than two days ago/)).toHaveClass(
    "text-destructive",
  );
});

it("says when no backup was recorded", async () => {
  mocks.status.mockResolvedValue(status({ last_backup: null }));
  setup();
  expect(
    await screen.findByText("No backup has been recorded."),
  ).toBeInTheDocument();
});

it("says the commit is unknown outside an image built with one", async () => {
  mocks.status.mockResolvedValue(status({ commit: "unknown" }));
  setup();
  expect(await screen.findByText("Unknown")).toBeInTheDocument();
});
