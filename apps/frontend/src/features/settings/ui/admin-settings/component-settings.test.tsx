import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleMutationSuccess } from "@/lib/mutation-cache";
import { ComponentSettings, parameterKind } from "./component-settings";

const mocks = vi.hoisted(() => ({ test: vi.fn(), components: vi.fn() }));

const example = { "1": { class_type: "KSampler", inputs: {} } };

// The shape pydantic produces for a component's parameter model.
const parameters = {
  type: "object",
  title: "ComfyUIParameters",
  properties: {
    base_url: { type: "string", title: "Server address", default: "" },
    token: { type: "string", title: "Token or password", default: "" },
    checkpoint: { type: "string", title: "Checkpoint", default: "" },
    workflow: {
      anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }],
      default: null,
      title: "Custom workflow",
      examples: [example],
    },
    steps: {
      type: "integer",
      minimum: 1,
      maximum: 150,
      default: 25,
      title: "Steps",
    },
    verify_tls: {
      type: "boolean",
      default: true,
      title: "Verify TLS certificates",
    },
  },
};

vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  componentsByTypeOptions: () => ({
    queryKey: [{ _id: "componentsByType", baseUrl: "" }],
    queryFn: () => {
      // Each fetch is a new response, so a refetch would hand the form a new
      // provider object.
      const fetch = mocks.components();
      return Promise.resolve({
        items: [
          {
            type: "ImageGenerator",
            name: "ComfyUI",
            description: `fetch ${fetch}`,
            parameters,
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
    },
  }),
  componentsTestMutation: () => ({ mutationFn: mocks.test }),
}));

let queryClient: QueryClient;

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function renderForm(stored: Record<string, unknown> = {}) {
  const onUpdate = vi.fn();
  render(
    <ComponentSettings
      component_type="ImageGenerator"
      settings_key="image_generator_provider"
      defaultValue={{ name: "ComfyUI", parameters: stored as never }}
      onUpdate={onUpdate}
    />,
    { wrapper: Wrapper },
  );
  return onUpdate;
}

describe("component settings form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let fetches = 0;
    mocks.components.mockImplementation(() => ++fetches);
    // The app's global invalidation, as wired in providers.tsx.
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
      mutationCache: new MutationCache({
        onSuccess: (_d, _v, _c, mutation) =>
          handleMutationSuccess(queryClient, mutation),
      }),
    });
  });

  it("picks an input for each schema type", () => {
    expect(parameterKind("auth", { enum: ["none", "bearer"] })).toBe("enum");
    expect(parameterKind("verify_tls", { type: "boolean" })).toBe("boolean");
    expect(parameterKind("steps", { type: "integer" })).toBe("number");
    expect(
      parameterKind("workflow", {
        anyOf: [{ type: "object" }, { type: "null" }],
      }),
    ).toBe("json");
    expect(parameterKind("api_key", { type: "string" })).toBe("secret");
    expect(parameterKind("base_url", { type: "string" })).toBe("text");
  });

  it("keeps switches and numbers typed when saving", async () => {
    const user = userEvent.setup();
    const onUpdate = renderForm({ base_url: "http://comfy", steps: 30 });

    const tls = await screen.findByRole("switch", {
      name: "Verify TLS certificates",
    });
    expect(tls).toBeChecked();
    expect(screen.getByLabelText("Token or password")).toHaveAttribute(
      "type",
      "password",
    );
    await user.click(tls);
    expect(onUpdate).toHaveBeenLastCalledWith({
      name: "ComfyUI",
      parameters: expect.objectContaining({ verify_tls: false, steps: 30 }),
    });

    const steps = screen.getByLabelText("Steps");
    await user.clear(steps);
    await user.type(steps, "12");
    expect(onUpdate).toHaveBeenLastCalledWith({
      name: "ComfyUI",
      parameters: expect.objectContaining({ steps: 12 }),
    });
  });

  it("edits JSON parameters, flags invalid text and offers the example", async () => {
    const user = userEvent.setup();
    const onUpdate = renderForm();

    const workflow = await screen.findByLabelText("Custom workflow");
    fireEvent.change(workflow, { target: { value: '{"1": ' } });
    expect(screen.getByText("This isn't valid JSON yet.")).toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({ workflow: expect.anything() }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Use the example" }));
    expect(screen.queryByText("This isn't valid JSON yet.")).toBeNull();
    expect(onUpdate).toHaveBeenLastCalledWith({
      name: "ComfyUI",
      parameters: expect.objectContaining({ workflow: example }),
    });

    fireEvent.change(workflow, { target: { value: "" } });
    expect(onUpdate).toHaveBeenLastCalledWith({
      name: "ComfyUI",
      parameters: expect.objectContaining({ workflow: null }),
    });
  });

  it("tests the unsaved parameters and offers what the server found", async () => {
    const user = userEvent.setup();
    mocks.test.mockResolvedValue({
      ok: false,
      detail: "Connected to ComfyUI 0.44.0, but it has no checkpoint named a",
      suggestions: { checkpoint: ["sdxl.safetensors", "flux.safetensors"] },
    });
    const onUpdate = renderForm({ base_url: "http://comfy", checkpoint: "a" });

    await user.click(
      await screen.findByRole("button", { name: "Test connection" }),
    );
    expect(
      await screen.findByText(
        "Connected to ComfyUI 0.44.0, but it has no checkpoint named a",
      ),
    ).toBeInTheDocument();
    expect(mocks.test.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        path: { component_type: "ImageGenerator", name: "ComfyUI" },
        body: {
          parameters: expect.objectContaining({
            base_url: "http://comfy",
            checkpoint: "a",
          }),
        },
      }),
    );

    await user.click(screen.getByRole("button", { name: "flux.safetensors" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Checkpoint")).toHaveValue(
        "flux.safetensors",
      ),
    );
    expect(onUpdate).toHaveBeenLastCalledWith({
      name: "ComfyUI",
      parameters: expect.objectContaining({ checkpoint: "flux.safetensors" }),
    });
  });

  it("keeps unsaved edits and refetches nothing when testing", async () => {
    const user = userEvent.setup();
    mocks.test.mockResolvedValue({ ok: true, detail: "Connected" });
    const onUpdate = renderForm({ base_url: "http://comfy" });

    const address = await screen.findByLabelText("Server address");
    await user.clear(address);
    await user.type(address, "http://edited");
    await user.click(screen.getByLabelText("Verify TLS certificates"));

    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connected")).toBeInTheDocument();

    expect(mocks.components).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryState([{ _id: "componentsByType", baseUrl: "" }])
        ?.isInvalidated,
    ).toBe(false);
    expect(screen.getByLabelText("Server address")).toHaveValue(
      "http://edited",
    );
    expect(screen.getByLabelText("Verify TLS certificates")).not.toBeChecked();
    expect(screen.getByText("* Updated")).toBeInTheDocument();
    expect(onUpdate).toHaveBeenLastCalledWith({
      name: "ComfyUI",
      parameters: expect.objectContaining({
        base_url: "http://edited",
        verify_tls: false,
      }),
    });
  });

  it("shows no test button for components that can't be tested", async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByRole("button", { name: "Test connection" });
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Diffusers" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Test connection" }),
      ).toBeNull(),
    );
  });
});
