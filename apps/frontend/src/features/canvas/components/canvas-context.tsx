"use client";
import React from "react";

export type CanvasContextValue = {
  /** The item open in the panel, if any. */
  openItemId: string | null;
  open: (itemId: string) => void;
  close: () => void;
  /** Changes whenever the transcript does, so canvas reads refetch with it. */
  transcriptKey: string;
  /** Sends a chat message; null while the chat can't take one. */
  ask: ((prompt: string) => Promise<void>) | null;
  /** The user may write versions (admin policy and their setting are on). */
  canEdit: boolean;
};

const CanvasContext = React.createContext<CanvasContextValue | null>(null);

export const CanvasProvider = CanvasContext.Provider;

/** The chat's canvas, or null outside a chat session. */
export const useCanvas = () => React.useContext(CanvasContext);
