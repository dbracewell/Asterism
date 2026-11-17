import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { handleMutationSuccess } from "@/lib/mutation-cache";
import { ImageGenSettings } from "./image-gen-settings";

const mocks = vi.hoisted(() => ({
  role: "admin",
  settings: vi.fn(),
  status: vi.fn(),
  policy: vi.fn(),
  saveSetting: vi.fn(),
  savePolicy: vi.fn(),
  test: vi.fn(),
}));
vi.mock("@/features/auth/components/user-context", () => ({
  useUser: () => ({ id: "admin", role: mocks.role }),
}));
vi.mock("@/lib/api", () => ({ client: {} }));
vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  appSettingsGetOptions: () => ({
    queryKey: [{ _id: "settings" }],
    queryFn: () => mocks.settings(),
  }),
  appSettingsGetQueryKey: () => [{ _id: "settings" }],
  appSettingUpdateMutation: () => ({ mutationFn: mocks.saveSetting }),
  fileGetManyQueryKey: () => [{ _id: "fileGetMany" }],
  fileGetManyInfiniteQueryKey: () => [{ _id: "fileGetMany", infinite: true }],
  groupGetManyOptions: () => ({
    queryKey: [{ _id: "groups" }],
    queryFn: () =>
      Promise.resolve([
        { id: "educator", name: "Educators" },
        { id: "student", name: "Students" },
      ]),
  }),
  imageGenerationPolicyGetOptions: () => ({
    queryKey: [{ _id: "policy" }],
    queryFn: () => mocks.policy(),
  }),
  imageGenerationPolicyGetQueryKey: () => [{ _id: "policy" }],
  imageGenerationPolicyUpdateMutation: () => ({ mutationFn: mocks.savePolicy }),
  imageGenerationProviderStatusOptions: () => ({
    queryKey: [{ _id: "status" }],
    queryFn: () => mocks.status(),
  }),
  imageGenerationProviderStatusQueryKey: () => [{ _id: "status" }],
  imageGenerationTestMutation: () => ({ mutationFn: mocks.test }),
  localImageOverviewQueryKey: () => [{ _id: "local" }],
}));
// The generic form and the local model list have their own tests.
vi.mock("@/features/settings/ui/admin-settings/component-settings", () => ({
  ComponentSettings: ({
    defaultValue,
    onUpdate,
    onProviderChange,
  }: {
    defaultValue?: { name: string } | null;
    onUpdate: (value: unknown) => void;
    onProviderChange: (name: string) => void;
  }) => (
    <div>
      <span>Selected: {defaultValue?.name ?? "none"}</span>
      <button onClick={() => onProviderChange("Diffusers")}>
        Pick Diffusers
      </button>
      <button
        onClick={() =>
          onUpdate({
            name: "ComfyUI",
            parameters: { base_url: "http://comfy", steps: 20 },
          })
        }
      >
        Edit ComfyUI
      </button>
    </div>
  ),
}));
vi.mock("@/features/settings/ui/admin-settings/local-image-models", () => ({
  LocalImageModels: () => <div>Local model list</div>,
  errorText: (error: { detail?: string }, fallback: string) =>
    error?.detail ?? fallback,
}));
vi.mock("@/components/api-image", () => ({
  APIImage: ({ filename }: { filename: string }) => <div>Image {filename}</div>,
}));

function setup() {
  // The app's global invalidation, as wired in providers.tsx.
  const cache: QueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    mutationCache: new MutationCache({
      onSuccess: (_d, _v, _c, mutation) =>
        handleMutationSuccess(cache, mutation),
    }),
  });
  render(
    <QueryClientProvider client={cache}>
      <ImageGenSettings />
    </QueryClientProvider>,
  );
  return cache;
}

beforeEach(() => {
  mocks.role = "admin";
  mocks.settings.mockReset().mockResolvedValue({
    image_generator_provider: { name: "ComfyUI", parameters: {} },
  });
  mocks.status.mockReset().mockResolvedValue({
    provider: "ComfyUI",
    ready: true,
    detail: "ComfyUI at http://comfy",
  });
  mocks.policy
    .mockReset()
    .mockResolvedValue({ enabled: false, group_ids: null });
  mocks.saveSetting.mockReset().mockResolvedValue({});
  mocks.savePolicy.mockReset().mockImplementation(async ({ body }) => body);
  mocks.test.mockReset();
});

it("is for administrators only", () => {
  mocks.role = "user";
  setup();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Administrator access is required",
  );
});

it("shows the generator's status and saves an edited generator", async () => {
  setup();
  const user = userEvent.setup();
  expect(await screen.findByTestId("generator-status")).toHaveTextContent(
    "Ready: ComfyUI at http://comfy",
  );
  const save = screen.getByRole("button", { name: "Save generator" });
  expect(save).toBeDisabled();
  expect(screen.queryByText("Local model list")).toBeNull();

  await user.click(screen.getByRole("button", { name: "Edit ComfyUI" }));
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  await user.click(save);
  await waitFor(() => expect(mocks.saveSetting).toHaveBeenCalledOnce());
  expect(mocks.saveSetting.mock.calls[0][0]).toEqual({
    path: { key: "image_generator_provider" },
    body: {
      value: {
        name: "ComfyUI",
        parameters: { base_url: "http://comfy", steps: 20 },
      },
    },
  });
  expect(await screen.findByText(/Generator saved/)).toBeVisible();
});

it("shows local models as soon as Diffusers is picked and reports save errors", async () => {
  mocks.saveSetting.mockRejectedValue({ detail: "Invalid Diffusers settings" });
  setup();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Pick Diffusers" }),
  );
  expect(screen.getByText("Local model list")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Save generator" }));
  expect(await screen.findByText("Invalid Diffusers settings")).toBeVisible();
  expect(mocks.saveSetting.mock.calls[0][0].body).toEqual({
    value: { name: "Diffusers", parameters: {} },
  });
});

it("turns generation on for selected groups", async () => {
  setup();
  const user = userEvent.setup();
  const save = await screen.findByRole("button", { name: "Save availability" });
  expect(save).toBeDisabled();
  await user.click(
    screen.getByRole("switch", { name: "Enable image generation" }),
  );
  expect(screen.queryByRole("list", { name: /Groups allowed/ })).toBeNull();
  await user.click(
    screen.getByRole("switch", { name: "Limit to selected groups" }),
  );
  const groups = screen.getByRole("list", { name: /Groups allowed/ });
  await user.click(within(groups).getByRole("checkbox", { name: "Educators" }));
  await user.click(save);
  await waitFor(() =>
    expect(mocks.savePolicy.mock.calls[0][0]).toEqual({
      body: { enabled: true, group_ids: ["educator"] },
    }),
  );
  expect(await screen.findByText("Availability saved.")).toBeVisible();
});

it("generates a test image and shows failures", async () => {
  mocks.test.mockRejectedValueOnce({ detail: "Download FLUX first" });
  setup();
  const user = userEvent.setup();
  const run = await screen.findByRole("button", {
    name: "Generate a test image",
  });
  await user.click(run);
  expect(await screen.findByText("Download FLUX first")).toBeVisible();

  mocks.test.mockResolvedValue({
    filename: "a-heron-7.png",
    prompt: "A heron",
    width: 1024,
    height: 1024,
    seed: 7,
    model: "sdxl.safetensors",
  });
  const prompt = screen.getByLabelText("Prompt");
  await user.clear(prompt);
  await user.type(prompt, "A heron");
  await user.click(run);
  expect(await screen.findByText("Image a-heron-7.png")).toBeVisible();
  expect(mocks.test.mock.calls[1][0]).toEqual({ body: { prompt: "A heron" } });
  expect(
    screen.getByText(/1024×1024 · sdxl.safetensors · seed 7/),
  ).toBeVisible();
});

it("keeps the unsaved generator and refreshes only file lists after a test image", async () => {
  mocks.test.mockResolvedValue({
    filename: "a-heron-7.png",
    prompt: "A heron",
    width: 1024,
    height: 1024,
    seed: 7,
    model: "sdxl.safetensors",
  });
  const cache = setup();
  cache.setQueryData([{ _id: "fileGetMany", page: 1 }], { items: [] });
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Edit ComfyUI" }));
  expect(screen.getByText("Unsaved changes")).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "Generate a test image" }),
  );
  expect(await screen.findByText("Image a-heron-7.png")).toBeVisible();

  expect(screen.getByText("Unsaved changes")).toBeVisible();
  expect(mocks.settings).toHaveBeenCalledTimes(1);
  expect(mocks.status).toHaveBeenCalledTimes(1);
  expect(mocks.policy).toHaveBeenCalledTimes(1);
  expect(
    cache.getQueryState([{ _id: "fileGetMany", page: 1 }])?.isInvalidated,
  ).toBe(true);
});
