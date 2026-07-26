import { ChatModel } from "@/lib/client";
import { create } from "zustand";

interface ActiveChatSessionState {
  session: ChatModel | null;
  setSession: (session: ChatModel | null) => void;
}

export const useActiveChatSession = create<ActiveChatSessionState>((set) => ({
  session: null,
  setSession: (session) => set({ session }),
}));
