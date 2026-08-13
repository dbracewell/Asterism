import { ReadyState } from "react-use-websocket";

export type ConnectionStatus =
  | "Connecting"
  | "Connected"
  | "Closing"
  | "Closed"
  | "Uninstantiated";

export const connectionStatusMap = {
  [ReadyState.CONNECTING]: "Connecting",
  [ReadyState.OPEN]: "Connected",
  [ReadyState.CLOSING]: "Closing",
  [ReadyState.CLOSED]: "Closed",
  [ReadyState.UNINSTANTIATED]: "Uninstantiated",
} as Record<number, ConnectionStatus>;

export type ScrollState = {
  userInitiatedScroll: boolean;
  preventAutoScroll: boolean;
};
