import { UserSettings } from "@/lib/client";

export type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  settings: UserSettings;
};
