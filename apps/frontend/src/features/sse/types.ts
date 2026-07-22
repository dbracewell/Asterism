export const EventTypeValues = ["connection:status", "chat-session:update"] as const;

export type EventType = (typeof EventTypeValues)[number];
