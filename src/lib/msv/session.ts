import { create } from "zustand";
import type { CableLink } from "./serial-session";

type SessionStore = {
  link: CableLink | null;
  can500: boolean;
  lead: string | null;
  attach: (link: CableLink, can500: boolean, lead: string) => void;
  updateCan: (can500: boolean) => void;
  detach: () => void;
};

export const useSession = create<SessionStore>((set) => ({
  link: null,
  can500: true,
  lead: null,
  attach: (link, can500, lead) => set({ link, can500, lead }),
  updateCan: (can500) => set({ can500 }),
  detach: () => set({ link: null, lead: null }),
}));
