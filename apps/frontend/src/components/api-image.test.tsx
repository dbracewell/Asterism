import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { APIImage } from "./api-image";

vi.mock("@/lib/api", () => ({ client: {} }));

const downloads = vi.fn();
vi.mock("@/lib/client/@tanstack/react-query.gen", () => {
  const info = (key: string) => () => ({
    queryKey: [key],
    queryFn: async () => ({ filename: "a.png", thumbnail: "data:thumb" }),
  });
  const download = (key: string) => (options: { path: object }) => ({
    queryKey: [key, options.path],
    queryFn: async () => {
      downloads(options.path);
      return new Blob([JSON.stringify(options.path)], { type: "image/png" });
    },
  });
  return {
    chatFileGetInfoOptions: info("chatFileGetInfo"),
    fileGetFileInfoOptions: info("fileGetFileInfo"),
    chatFileDownloadOptions: download("chatFileDownload"),
    fileGetOneOptions: download("fileGetOne"),
  };
});

let nextUrl = 0;
beforeEach(() => {
  downloads.mockClear();
  nextUrl = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/${++nextUrl}`);
  URL.revokeObjectURL = vi.fn();
});

function renderWith(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrap = (node: React.ReactElement) => (
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
  );
  const result = render(wrap(ui));
  return {
    ...result,
    rerender: (next: React.ReactElement) => result.rerender(wrap(next)),
  };
}

const enlargedSrc = () =>
  screen.getByRole("dialog").querySelector("img")?.getAttribute("src");

it("loads the full chat image only when opened and keeps its URL", async () => {
  renderWith(
    <APIImage chatId="c1" fileId="f1" filename="a.png" alt="Chart" zoomable />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Enlarge Chart" }));
  expect(downloads).toHaveBeenCalledTimes(1);
  expect(downloads).toHaveBeenCalledWith({ chat_id: "c1", file_id: "f1" });

  await waitFor(() => expect(enlargedSrc()).toBe("blob:test/1"));
  // The stored URL stays usable; storing it must not revoke it.
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});

it("does not download before the preview opens", async () => {
  renderWith(<APIImage filename="a.png" alt="Chart" zoomable />);
  await screen.findByRole("button", { name: "Enlarge Chart" });
  expect(downloads).not.toHaveBeenCalled();
});

it("revokes the URL on unmount", async () => {
  const { unmount } = renderWith(
    <APIImage filename="a.png" alt="Chart" zoomable />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Enlarge Chart" }));
  await waitFor(() => expect(enlargedSrc()).toBe("blob:test/1"));
  expect(downloads).toHaveBeenCalledWith({ filename: "a.png" });

  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test/1");
});

it("revokes and replaces the URL when the file changes", async () => {
  const { rerender } = renderWith(
    <APIImage chatId="c1" fileId="f1" filename="a.png" alt="Chart" zoomable />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Enlarge Chart" }));
  await waitFor(() => expect(enlargedSrc()).toBe("blob:test/1"));

  rerender(
    <APIImage chatId="c1" fileId="f2" filename="b.png" alt="Chart" zoomable />,
  );
  await waitFor(() => expect(enlargedSrc()).toBe("blob:test/2"));
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test/1");
  expect(downloads).toHaveBeenLastCalledWith({ chat_id: "c1", file_id: "f2" });
});
