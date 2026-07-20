import { create } from "zustand";

interface SideBarWidthState {
  width: string;
  setSideBarWidth: (width: string) => void;
}

export const useSideBarWidth = create<SideBarWidthState>((set) => ({
  width: "18rem",
  setSideBarWidth: (width) => set({ width }),
}));
