import { EventEmitter } from "events";

const globalWithEmitter = global as unknown as { sseEmitter: EventEmitter };

if (!globalWithEmitter.sseEmitter) {
  globalWithEmitter.sseEmitter = new EventEmitter();
  globalWithEmitter.sseEmitter.setMaxListeners(50);
}

export const sseEmitter = globalWithEmitter.sseEmitter;
