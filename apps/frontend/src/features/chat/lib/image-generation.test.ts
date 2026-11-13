import type { Message } from "@/lib/client";
import { describe, expect, it } from "vitest";
import {
  imageProgress,
  imagePrompts,
  imageToolLabel,
} from "./image-generation";

const progress = (stage: string, step?: number, total?: number) => ({
  type: "tool_progress" as const,
  tool_call_id: "call-1",
  name: "generate_image",
  stage,
  step,
  total,
});

describe("image progress", () => {
  it("describes each stage and counts steps", () => {
    expect(imageProgress(null)).toBeNull();
    expect(
      imageProgress({ ...progress("running"), name: "web_search" }),
    ).toBeNull();
    expect(imageProgress(progress("queued"))).toEqual({
      label: "Waiting for the image generator…",
      percent: null,
    });
    expect(imageProgress(progress("loading"))?.label).toMatch(
      /Loading the image model/,
    );
    expect(imageProgress(progress("running", 0, 8))).toEqual({
      label: "Creating the image…",
      percent: null,
    });
    expect(imageProgress(progress("running", 2, 8))).toEqual({
      label: "Creating the image: step 2 of 8",
      percent: 25,
    });
    expect(imageProgress(progress("saving"))).toEqual({
      label: "Saving the image…",
      percent: 100,
    });
  });
});

const A = "10000000-0000-4000-8000-00000000000a";
const B = "10000000-0000-4000-8000-00000000000b";
const C = "10000000-0000-4000-8000-00000000000c";

const result = (images: object[]) => ({
  images,
  show_in_reply: "include the embeds",
});

describe("image tool label", () => {
  it("is only for the image tool and counts saved images", () => {
    expect(imageToolLabel("web_search", "running")).toBeUndefined();
    expect(imageToolLabel("generate_image", "running")).toBe(
      "Creating an image",
    );
    expect(imageToolLabel("generate_image", "failed")).toBe(
      "Could not create the image",
    );
    expect(
      imageToolLabel(
        "generate_image",
        "succeeded",
        result([{ file_id: A, prompt: "a fox" }]),
      ),
    ).toBe("Created an image");
    // The result may arrive as JSON text.
    expect(
      imageToolLabel(
        "generate_image",
        "succeeded",
        JSON.stringify(
          result([
            { file_id: A, prompt: "a fox" },
            { file_id: B, prompt: "a fox" },
          ]),
        ),
      ),
    ).toBe("Created 2 images");
    expect(imageToolLabel("generate_image", "succeeded", "not json")).toBe(
      "Created an image",
    );
  });
});

const message = (values: Partial<Message>) =>
  ({ id: crypto.randomUUID(), status: "completed", ...values }) as Message;

describe("image prompts", () => {
  it("takes the agent's prompt from tool results, and the request's text on the direct path", () => {
    const prompts = imagePrompts([
      message({ role: "user", content: "Draw me a fox" }),
      message({
        role: "assistant",
        tool_call_results: [
          {
            content: "",
            is_empty: false,
            raw_result: result([
              { file_id: A, prompt: "A red fox in fresh snow, golden hour" },
            ]),
            tool_call: {
              id: "call-1",
              type: "function",
              function: { name: "generate_image", arguments: "{}" },
            },
          },
          {
            content: "",
            is_empty: false,
            raw_result: result([{ file_id: C, prompt: "ignored" }]),
            tool_call: {
              id: "call-2",
              type: "function",
              function: { name: "web_search", arguments: "{}" },
            },
          },
        ],
      } as Partial<Message>),
      message({
        role: "assistant",
        content: `Here: ![fox](asterism-file:${A})`,
      }),
      // Create image with a model that has no tools: no tool results at all.
      message({
        role: "user",
        content: "A heron at dawn",
        image_request: true,
      }),
      message({ role: "assistant", content: `![heron](asterism-file:${B})` }),
      // An ordinary reply that embeds a file isn't a generated image.
      message({ role: "user", content: "Show my chart" }),
      message({ role: "assistant", content: `![chart](asterism-file:${C})` }),
    ]);
    expect([...prompts]).toEqual([
      [A, "A red fox in fresh snow, golden hour"],
      [B, "A heron at dawn"],
    ]);
  });
});
