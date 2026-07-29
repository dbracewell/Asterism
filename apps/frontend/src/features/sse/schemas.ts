import { z } from "zod";
import { EventType } from "@/features/sse/types";
import { zMessageModel } from "@/lib/client/zod.gen";

export const EventMessageSchema = z.object({
  type: z.string(),
  userId: z.string().optional(),
  payload: z.unknown(),
});

export type EventMessage = z.infer<typeof EventMessageSchema>;

export const EventPayloadSchemas = {
  "chat-session:update": z.object({
    session_id: z.string(),
    title: z.string().nullable(),
    folder_id: z.string().nullable(),
  }),
  "chat-session:message-update": z.object({
    incomingMessage: zMessageModel.nullish(),
    updatedMessages: zMessageModel.array().nullish(),
    markLastCompleted: z.boolean().nullish(),
  }),
  "connection:status": z.object({ status: z.boolean() }),
  "chat-session:scroll": z.object({
    session_id: z.string(),
    canScroll: z.boolean(),
    scrollToBottom: z.boolean(),
  }),
} as const;

export type EventPayloadMap = {
  [K in EventType]: z.infer<(typeof EventPayloadSchemas)[K]>;
};
