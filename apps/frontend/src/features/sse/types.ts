export const EventTypeValues = [
  "connection:status",
  "chat-session:update",
  "chat-session:scroll",
  "chat-session:message-update",
] as const;

export type EventType = (typeof EventTypeValues)[number];
