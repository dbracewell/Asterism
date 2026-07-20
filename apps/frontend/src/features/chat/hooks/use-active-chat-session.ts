import { ChatSessionModel } from "@/lib/client";
import { create } from "zustand";

interface ActiveChatSessionState {
  session: ChatSessionModel | null;
  setSession: (session: ChatSessionModel | null) => void;
}

export const useActiveChatSession = create<ActiveChatSessionState>((set) => ({
  session: null,
  setSession: (session) => set({ session }),
}));
