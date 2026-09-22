import { zChatCompletionParams } from "@/lib/client/zod.gen";
import z from "zod";

export const agentProfile = z.object({
  id: z.uuid().nullable(),
  name: z
    .string()
    .min(3, "Name is required")
    .max(30, "Name must be between 3 and 30 characters")
    .describe("The agent's name"),
  description: z
    .string()
    .min(3, "Description is required")
    .max(256, "Description must be between 3 and 256 characters")
    .describe(
      "Describes what actions the agent performs. Used to help other agents determine who to ask questions to.",
    ),
  sub_agent: z
    .boolean()
    .describe(
      "Whether this agent can be used as a sub-agent of another agent.",
    ),
  systemPrompt: z
    .string()
    .nullable()
    .describe("The system prompt for the agent"),
  maxSteps: z
    .number()
    .int()
    .min(1, "Max steps must be at least 1")
    .max(20, "Max steps must be between 1 and 20")
    .describe(
      "The maximum number of steps the agent can take to answer a question.",
    ),
  modelId: z.uuid(),
  tools: z
    .array(
      z.object({
        value: z.string().min(1, "Tool name cannot be empty"),
      }),
    )
    .describe("The tools the agent can use"),
  knowledgeBaseIds: z.array(z.uuid()).max(100),
  chatParameters: zChatCompletionParams,
});
