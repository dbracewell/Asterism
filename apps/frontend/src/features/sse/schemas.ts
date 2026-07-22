import { z } from "zod";
import { EventType } from "@/features/sse/types";

export const EventMessageSchema = z.object({
  type: z.string(),
  userId: z.string().optional(),
  payload: z.unknown(),
});

export type EventMessage = z.infer<typeof EventMessageSchema>;

export const EventPayloadSchemas = {
  "chat-session:update": z.object({
    title: z.string().nullable(),
    folder_id: z.string().nullable(),
  }),
  "connection:status": z.object({ status: z.boolean() }),
} as const;

export type EventPayloadMap = {
  [K in EventType]: z.infer<(typeof EventPayloadSchemas)[K]>;
};
