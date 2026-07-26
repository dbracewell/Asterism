export const EventTypeValues = [
  "connection:status",
  "chat-session:update",
  "chat-session:scroll",
] as const;

export type EventType = (typeof EventTypeValues)[number];
