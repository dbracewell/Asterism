import type { Page } from "@playwright/test";
import { expect, test } from "./support/test";

// US-76.4: an administrator sets up image generation with each generator.
// The backend is mocked; its behavior is covered by test_comfyui.py,
// test_local_image_generation.py and test_image_generation.py.

// A 1×1 PNG as the saved test image's thumbnail.
const THUMBNAIL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const comfyuiParameters = {
  type: "object",
  title: "ComfyUIParameters",
  properties: {
    base_url: { type: "string", title: "Server address", default: "" },
    token: { type: "string", title: "Token or password", default: "" },
    checkpoint: { type: "string", title: "Checkpoint", default: "" },
    steps: { type: "integer", title: "Steps", default: 25, minimum: 1 },
    verify_tls: {
      type: "boolean",
      title: "Verify TLS certificates",
      default: true,
    },
  },
};

const model = (id: string, name: string, values: object = {}) => ({
  id,
  name,
  repo: `org/${id}`,
  revision: "r1",
  license: "Apache 2.0",
  commercial_use: true,
  description: `${name} description`,
  disk_gb: 16,
  memory_gb: 18,
  plan: { fits: true, mode: "device", detail: "Runs fully on RTX 4090" },
  download: { status: "idle", bytes_downloaded: 0, total_bytes: 16e9 },
  license_accepted: true,
  ...values,
});

type Write = { method: string; path: string; body: unknown };

async function mockBackend(page: Page) {
  const writes: Write[] = [];
  const state = {
    generator: null as { name: string; parameters: object } | null,
    policy: { enabled: false, group_ids: null as string[] | null },
    local: {
      model_id: null as string | null,
      device: "auto",
      accepted_licenses: [] as string[],
    },
    // Reads of the overview left before the download finishes.
    downloading: -1,
  };
  const overview = () => {
    const qwen =
      state.downloading > 0
        ? { status: "downloading", bytes_downloaded: 8e9, total_bytes: 32e9 }
        : state.downloading === 0
          ? { status: "ready", bytes_downloaded: 32e9, total_bytes: 32e9 }
          : { status: "idle", bytes_downloaded: 0, total_bytes: 32e9 };
    return {
      installed: true,
      hardware: {
        device: "cuda",
        name: "RTX 4090",
        memory_gb: 24,
        free_gb: 23,
        system_ram_gb: 64,
        cpu_count: 16,
        bf16: true,
        available: ["cuda", "cpu"],
      },
      recommended_id: "qwen-image-2.1-turbo",
      settings: state.local,
      worker_running: false,
      models: [
        model("qwen-image-2.1-turbo", "Qwen-Image-2.1 Turbo", {
          license: "Qwen Research License (non-commercial)",
          commercial_use: false,
          license_accepted: state.local.accepted_licenses.length > 0,
          disk_gb: 32.5,
          download: qwen,
        }),
        model("flux2-klein-4b", "FLUX.2 [klein] 4B"),
      ],
    };
  };
  await page.route("**/api/py/**", (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname.replace("/api/py", "");
    const body = method === "GET" ? null : request.postDataJSON();
    if (method !== "GET") writes.push({ method, path, body });
    const json = (value: unknown) => route.fulfill({ json: value });

    if (path === "/settings/app" && method === "GET")
      return json({
        active_tools: [],
        image_generator_provider: state.generator,
      });
    if (path === "/settings/app/image_generator_provider") {
      state.generator = body.value;
      return json({ key: "image_generator_provider", value: body.value });
    }
    if (path === "/components/by_type/ImageGenerator")
      return json({
        items: [
          {
            type: "ImageGenerator",
            name: "ComfyUI",
            parameters: comfyuiParameters,
            testable: true,
          },
          {
            type: "ImageGenerator",
            name: "Diffusers",
            parameters: { type: "object", properties: {} },
            testable: false,
          },
        ],
      });
    if (path === "/components/ImageGenerator/ComfyUI/test")
      return json({
        ok: true,
        detail: "Connected to ComfyUI 0.44.0 on cuda:0",
        suggestions: { checkpoint: ["sdxl.safetensors", "flux.safetensors"] },
      });
    if (path === "/settings/app/image-generation/status")
      return json(
        state.generator
          ? {
              provider: state.generator.name,
              ready: true,
              detail:
                state.generator.name === "ComfyUI"
                  ? "ComfyUI at http://comfy:8188"
                  : "Qwen-Image-2.1 Turbo: Runs fully on RTX 4090",
            }
          : {
              provider: "none",
              ready: false,
              detail: "No image provider is set up",
            },
      );
    if (path === "/settings/app/image-generation/test")
      return json({
        file_id: "11111111-1111-4111-8111-111111111111",
        filename: "a-lighthouse-42.png",
        width: 1024,
        height: 1024,
        seed: 42,
        model: "sdxl.safetensors",
        prompt: body.prompt,
        embed: "![a-lighthouse-42.png](asterism-file:1)",
      });
    if (path === "/files/info/a-lighthouse-42.png")
      return json({
        filename: "a-lighthouse-42.png",
        original_name: "a-lighthouse-42.png",
        thumbnail: THUMBNAIL,
      });
    if (path === "/settings/app/image-generation") {
      if (method === "PUT") state.policy = body;
      return json(state.policy);
    }
    if (path === "/groups")
      return json(
        ["Admin", "Educator", "Student"].map((name) => ({
          id: name.toLowerCase(),
          name,
          built_in: true,
          member_count: 1,
          models: null,
          tools: null,
        })),
      );
    if (path === "/settings/app/image-generation/local") {
      if (method === "PUT") state.local = { ...state.local, ...body };
      else if (state.downloading > 0) state.downloading -= 1;
      return json(overview());
    }
    if (path.endsWith("/models/qwen-image-2.1-turbo/download")) {
      state.local.accepted_licenses = ["qwen-image-2.1-turbo"];
      state.downloading = 2;
      return json(overview());
    }
    return route.fulfill({
      status: 503,
      json: { detail: "Fixture unavailable" },
    });
  });
  return { writes, state };
}

const open = async (page: Page) => {
  await page.goto("/e2e/planned-settings?setting=image-generation");
  const panel = page.getByRole("tabpanel").last();
  await expect(
    panel.getByRole("heading", { name: "Image generation" }),
  ).toBeVisible();
  return panel;
};

test("an administrator connects ComfyUI, tries it and turns generation on", async ({
  page,
}, info) => {
  const { writes } = await mockBackend(page);
  const panel = await open(page);
  await expect(panel.getByTestId("generator-status")).toHaveText(
    "Not ready: No image provider is set up",
  );

  await panel.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "ComfyUI" }).click();
  await panel.getByLabel("Server address").fill("http://comfy:8188");
  await panel.getByRole("button", { name: "Test connection" }).click();
  await expect(
    panel.getByText("Connected to ComfyUI 0.44.0 on cuda:0"),
  ).toBeVisible();
  // The server's checkpoints are offered as choices.
  await panel.getByRole("button", { name: "sdxl.safetensors" }).click();
  await expect(panel.getByLabel("Checkpoint")).toHaveValue("sdxl.safetensors");
  await expect(
    panel.getByRole("switch", { name: "Verify TLS certificates" }),
  ).toBeChecked();

  await panel.getByRole("button", { name: "Save generator" }).click();
  await expect(panel.getByTestId("generator-status")).toHaveText(
    "Ready: ComfyUI at http://comfy:8188",
  );
  expect(
    writes.find((w) => w.path === "/settings/app/image_generator_provider")
      ?.body,
  ).toEqual({
    value: {
      name: "ComfyUI",
      parameters: {
        base_url: "http://comfy:8188",
        token: "",
        checkpoint: "sdxl.safetensors",
        steps: 25,
        verify_tls: true,
      },
    },
  });

  await panel.getByRole("button", { name: "Generate a test image" }).click();
  await expect(
    panel.getByText(/1024×1024 · sdxl\.safetensors · seed 42/),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /Enlarge Test image/ }),
  ).toBeVisible();

  await panel.getByRole("switch", { name: "Enable image generation" }).click();
  await panel.getByRole("switch", { name: "Limit to selected groups" }).click();
  await panel.getByRole("checkbox", { name: "Educator" }).click();
  await panel.getByRole("button", { name: "Save availability" }).click();
  await expect(panel.getByText("Availability saved.")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("comfyui.png"),
    fullPage: true,
  });
  expect(writes.at(-1)).toEqual({
    method: "PUT",
    path: "/settings/app/image-generation",
    body: { enabled: true, group_ids: ["educator"] },
  });
});

test("an administrator downloads a local model after accepting its license", async ({
  page,
}, info) => {
  const { writes } = await mockBackend(page);
  const panel = await open(page);

  await panel.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Diffusers" }).click();
  await expect(panel.getByTestId("hardware")).toHaveText(
    "RTX 4090 · 24 GB GPU memory",
  );
  const qwen = panel.getByRole("listitem", { name: "Qwen-Image-2.1 Turbo" });
  await expect(qwen.getByText("Recommended")).toBeVisible();
  await expect(qwen.getByText("Non-commercial", { exact: true })).toBeVisible();

  await qwen.getByRole("button", { name: "Download" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Qwen Research License (non-commercial)");
  expect(writes).toEqual([]);
  await dialog.getByRole("button", { name: "Accept and download" }).click();
  await expect(
    qwen.getByRole("progressbar", { name: "Downloading Qwen-Image-2.1 Turbo" }),
  ).toBeVisible();
  expect(writes[0]).toEqual({
    method: "POST",
    path: "/settings/app/image-generation/local/models/qwen-image-2.1-turbo/download",
    body: { accept_license: true },
  });

  // The page polls until the download is ready.
  await page.screenshot({ path: info.outputPath("local.png"), fullPage: true });
  await qwen.getByRole("button", { name: "Use this model" }).click();
  await expect(qwen.getByText("In use")).toBeVisible();
  expect(writes.at(-1)).toEqual({
    method: "PUT",
    path: "/settings/app/image-generation/local",
    body: { model_id: "qwen-image-2.1-turbo", device: "auto" },
  });

  await panel.getByRole("button", { name: "Save generator" }).click();
  await expect(panel.getByTestId("generator-status")).toHaveText(
    "Ready: Qwen-Image-2.1 Turbo: Runs fully on RTX 4090",
  );
  expect(writes.at(-1)?.body).toEqual({
    value: { name: "Diffusers", parameters: {} },
  });
});
