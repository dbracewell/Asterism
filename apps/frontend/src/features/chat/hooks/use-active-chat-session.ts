import { create } from "zustand";

interface ActiveChatSessionState {
  id: string | null;
  title: string | null;
  setSession: ({
    id,
    title,
  }: {
    id: string | null;
    title: string | null;
  }) => void;
}

export const useActiveChatSession = create<ActiveChatSessionState>((set) => ({
  id: null,
  title: null,
  setSession: ({ id, title }) => set({ id, title }),
}));
