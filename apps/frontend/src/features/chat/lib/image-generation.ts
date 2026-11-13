import type { Message } from "@/lib/client";
import type { ToolProgressEvent } from "../schemas";
import type { ToolStepStatus } from "./agent-timeline";

/** The image generation tool (ADR-0064). */
export const IMAGE_TOOL = "generate_image";

/** What the turn is doing while an image is made, and how far along it is. */
export function imageProgress(
  progress: ToolProgressEvent | null,
): { label: string; percent: number | null } | null {
  if (!progress || progress.name !== IMAGE_TOOL) return null;
  const { stage, step, total } = progress;
  if (stage === "queued")
    return { label: "Waiting for the image generator…", percent: null };
  if (stage === "loading")
    return {
      label: "Loading the image model; the first image takes longer…",
      percent: null,
    };
  if (stage === "saving") return { label: "Saving the image…", percent: 100 };
  if (step && total)
    return {
      label: `Creating the image: step ${step} of ${total}`,
      percent: Math.min(100, Math.round((step / total) * 100)),
    };
  return { label: "Creating the image…", percent: null };
}

type SavedImage = { file_id: string; prompt: string };

/** The saved images in a tool result, given as the raw object or its JSON text. */
function savedImages(result: unknown): SavedImage[] {
  let parsed = result;
  if (typeof result === "string") {
    try {
      parsed = JSON.parse(result);
    } catch {
      return [];
    }
  }
  const images = (parsed as { images?: unknown } | null)?.images;
  if (!Array.isArray(images)) return [];
  return images.filter(
    (image): image is SavedImage =>
      typeof image?.file_id === "string" && typeof image?.prompt === "string",
  );
}

/** "Created 2 images" for an image tool call; undefined for other tools. */
export function imageToolLabel(
  name: string,
  status: ToolStepStatus,
  result?: unknown,
): string | undefined {
  if (name !== IMAGE_TOOL) return undefined;
  if (status === "running") return "Creating an image";
  if (status === "failed" || status === "denied")
    return "Could not create the image";
  if (status === "succeeded") {
    const count = savedImages(result).length;
    return count > 1 ? `Created ${count} images` : "Created an image";
  }
  return "Create an image";
}

const EMBED = /asterism-file:([0-9a-fA-F-]{36})/g;

/**
 * The prompt behind each generated image on a branch, by file id.
 *
 * The agent's tool results name the prompt it used. A Create image turn on a
 * model without tools has no tool results, so its images take the text of the
 * message that asked for them.
 */
export function imagePrompts(messages: Message[]): Map<string, string> {
  const prompts = new Map<string, string>();
  let request: Message | null = null;
  for (const message of messages) {
    if (message.role === "user") {
      request = message;
      continue;
    }
    for (const result of message.tool_call_results ?? []) {
      if (result.tool_call.function.name !== IMAGE_TOOL) continue;
      for (const image of savedImages(result.raw_result ?? result.content))
        prompts.set(image.file_id, image.prompt);
    }
    if (request?.image_request && request.content) {
      for (const [, id] of (message.content ?? "").matchAll(EMBED))
        if (!prompts.has(id)) prompts.set(id, request.content);
    }
  }
  return prompts;
}
