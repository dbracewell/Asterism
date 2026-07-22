import {
  EventMessageSchema,
  EventPayloadSchemas,
} from "@/features/sse/schemas";
import { EventType, EventTypeValues } from "@/features/sse/types";
import { eventBus } from "@/features/sse/lib/event-bus";

export const eventRouter = (msg: string) => {
  let raw: unknown;
  try {
    raw =  typeof(msg) === "string" ? JSON.parse(msg) : msg;
  } catch {
    console.error("Unable to parse JSON", msg);
    return;
  }

  const env = EventMessageSchema.safeParse(raw);
  if (!env.success) {
    console.error("Unable to parse event", msg);
    return;
  }

  const { type, payload } = env.data;
  if (!EventTypeValues.includes(type as EventType)) {
    console.error("Unknown EventType", type);
    return;
  }

  const parsed = EventPayloadSchemas[type as EventType].safeParse(payload);
  if (!parsed.success) {
    console.error("Could not parse payload", type, payload, parsed.error);
    return;
  }

  eventBus.emit(type as EventType, parsed.data);
};
