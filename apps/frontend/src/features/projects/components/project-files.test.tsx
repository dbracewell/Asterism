import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { ApiClient } from "@/lib/client";
import { ProjectFiles } from "./project-files";
import * as FileManager from "@/components/file-manager";

const { api } = vi.hoisted(() => ({
  api: {
    projectGetOne: vi.fn(),
    projectFileGetMany: vi.fn(),
    fileGetMany: vi.fn(),
    projectFileAddMany: vi.fn(),
    projectFileRemoveMany: vi.fn(),
    fileUpload: vi.fn(),
    fileKnowledgeGetStatus: vi.fn(),
    fileKnowledgeRegenerate: vi.fn(),
    fileDeleteMany: vi.fn(),
  },
}));
vi.mock("@/lib/api", () => ({
  client: { getConfig: () => ({ baseUrl: "" }) },
}));
const project = { id: "p", name: "Research", context_revision: 3 };
const file = (id: string, member = false) => ({
  id,
  filename: `${id}.txt`,
  original_name: `${id}.txt`,
  kind: "text",
  size: 10,
  projects: member ? [project, { id: "other", name: "Shared" }] : [],
});
const page = (files: ReturnType<typeof file>[]) => ({
  files,
  total: files.length,
  page: 1,
  page_size: 50,
});
function setup(element = <ProjectFiles projectId="p" />) {
  const qc = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: () => {
        qc.invalidateQueries();
      },
    }),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    ...render(
      <QueryClientProvider client={qc}>
        <TooltipProvider>{element}</TooltipProvider>
      </QueryClientProvider>,
    ),
    qc,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  ApiClient.__registry.set(api as never);
  api.projectGetOne.mockResolvedValue({ data: project });
  api.projectFileGetMany.mockResolvedValue({
    data: page([file("member", true)]),
  });
  api.fileGetMany.mockResolvedValue({
    data: page([file("member", true), file("new")]),
  });
  api.fileKnowledgeGetStatus.mockResolvedValue({
    data: {
      status: "failed",
      extractions: {
        embedding: { kind: "embedding", status: "failed" },
      },
    },
  });
  api.projectFileAddMany.mockResolvedValue({ data: { context_revision: 4 } });
  api.projectFileRemoveMany.mockResolvedValue({
    data: { context_revision: 4 },
  });
  api.fileUpload.mockResolvedValue({ data: page([file("uploaded")]) });
});
it("uses the project query, shows shared memberships and unavailable artifacts, and filters on the server", async () => {
  setup();
  expect(await screen.findByText("member.txt")).toBeInTheDocument();
  expect(await screen.findByText("Embedding: failed")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Shared" })).toHaveAttribute(
    "href",
    "/projects/other",
  );
  expect(screen.getByRole("link", { name: "Open member.txt" })).toHaveAttribute(
    "href",
    "/files/member.txt",
  );
  expect(api.fileGetMany).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Delete selected files" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Toggle Search" }));
  await userEvent.type(
    screen.getByRole("textbox", { name: "Search files" }),
    "missing",
  );
  await waitFor(() =>
    expect(api.projectFileGetMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: { project_id: "p" },
        query: expect.objectContaining({ query: "missing", page: 1 }),
      }),
    ),
  );
});
it("excludes existing members, adds only selected library files atomically, and never regenerates them", async () => {
  setup();
  await screen.findByText("member.txt");
  await userEvent.click(
    screen.getByRole("button", { name: "Add library files" }),
  );
  const dialog = within(screen.getByRole("dialog"));
  await dialog.findByText(/Already in this project/);
  await userEvent.click(dialog.getByRole("button", { name: /member.txt/ }));
  expect(
    dialog.getByRole("button", { name: "Add selected (0)" }),
  ).toBeDisabled();
  await userEvent.click(
    dialog.getByRole("button", { name: "Select all files" }),
  );
  await userEvent.click(
    dialog.getByRole("button", { name: "Add selected (1)" }),
  );
  await waitFor(() =>
    expect(api.projectFileAddMany).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { project_id: "p" },
        body: { file_ids: ["new"], expected_context_revision: 3 },
      }),
    ),
  );
  expect(api.fileKnowledgeRegenerate).not.toHaveBeenCalled();
  expect(api.fileUpload).not.toHaveBeenCalled();
});
it("confirms membership removal separately from physical deletion", async () => {
  setup();
  await userEvent.click(
    await screen.findByRole("button", { name: /member.txt/ }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Remove from project" }),
  );
  expect(
    screen.getByText(/Library files, processing artifacts, other projects/),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() =>
    expect(api.projectFileRemoveMany).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { file_ids: ["member"], expected_context_revision: 3 },
        path: { project_id: "p" },
      }),
    ),
  );
  expect(api.fileDeleteMany).not.toHaveBeenCalled();
});
it("uploads once, then adds the returned immutable IDs to the project", async () => {
  setup();
  await screen.findByText("member.txt");
  await userEvent.upload(
    screen.getByLabelText("Choose attachments"),
    new File(["hello"], "upload.txt", { type: "text/plain" }),
  );
  await waitFor(() =>
    expect(api.projectFileAddMany).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { file_ids: ["uploaded"], expected_context_revision: 3 },
      }),
    ),
  );
  expect(api.fileUpload).toHaveBeenCalledTimes(1);
});
it("keeps the picker open on revision conflict and permits explicit refresh before retry", async () => {
  api.projectFileAddMany.mockRejectedValueOnce({ detail: "Project changed" });
  setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "Add library files" }),
  );
  const dialog = within(screen.getByRole("dialog"));
  await userEvent.click(await dialog.findByRole("button", { name: /new.txt/ }));
  await userEvent.click(
    dialog.getByRole("button", { name: "Add selected (1)" }),
  );
  expect(await dialog.findByRole("alert")).toHaveTextContent(
    "Could not add files",
  );
  api.projectGetOne.mockResolvedValue({
    data: { ...project, context_revision: 5 },
  });
  await userEvent.click(dialog.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(
      dialog.getByRole("button", { name: "Add selected (1)" }),
    ).toBeEnabled(),
  );
  await userEvent.click(
    dialog.getByRole("button", { name: "Add selected (1)" }),
  );
  await waitFor(() =>
    expect(api.projectFileAddMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: { file_ids: ["new"], expected_context_revision: 5 },
      }),
    ),
  );
});
it("shows a retryable list failure and retains cached files if refresh fails", async () => {
  const { qc } = setup();
  await screen.findByText("member.txt");
  api.projectFileGetMany.mockRejectedValue({ detail: "Offline" });
  await qc.invalidateQueries();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to load files",
  );
  expect(screen.getByText("member.txt")).toBeInTheDocument();
});
it("clears selection when changing the page or search", async () => {
  setup();
  await userEvent.click(
    await screen.findByRole("button", { name: /member.txt/ }),
  );
  expect(
    screen.getByRole("button", { name: "Remove from project" }),
  ).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "Toggle Search" }));
  await userEvent.type(screen.getByLabelText("Search files"), "new");
  expect(
    screen.getByRole("button", { name: "Remove from project" }),
  ).toBeDisabled();
});
it("restricts physical deletion by permitted actions in a shared explorer", async () => {
  setup(
    <FileManager.Provider
      actions={{ upload: false, delete: false, regenerate: false }}
    >
      <FileManager.Ribbon>
        <FileManager.UploadFilesSection />
        <FileManager.DeleteSelectedFilesSection />
      </FileManager.Ribbon>
      <FileManager.FileList />
    </FileManager.Provider>,
  );
  await screen.findByText("new.txt");
  expect(
    screen.queryByRole("button", { name: "Delete selected files" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Upload files" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Regenerate embedding and caption" }),
  ).not.toBeInTheDocument();
});

it("preserves project links and removal controls when a processing record is missing", async () => {
  api.fileKnowledgeGetStatus.mockRejectedValue({
    detail: "Processing record missing",
  });
  setup();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to load file processing status",
  );
  expect(screen.getByRole("link", { name: "Shared" })).toHaveAttribute(
    "href",
    "/projects/other",
  );
  await userEvent.click(screen.getByRole("button", { name: /member.txt/ }));
  expect(
    screen.getByRole("button", { name: "Remove from project" }),
  ).toBeEnabled();
});

it("explains that a failed upload membership leaves the file in the library", async () => {
  const notify = vi.spyOn(toast, "error");
  api.projectFileAddMany.mockRejectedValue({ detail: "Revision conflict" });
  setup();
  await screen.findByText("member.txt");
  await userEvent.upload(
    screen.getByLabelText("Choose attachments"),
    new File(["hello"], "upload.txt"),
  );
  await waitFor(() =>
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining(
        "Files uploaded to the library, but could not be added",
      ),
    ),
  );
  expect(api.fileUpload).toHaveBeenCalledTimes(1);
  expect(api.fileDeleteMany).not.toHaveBeenCalled();
  notify.mockRestore();
});
