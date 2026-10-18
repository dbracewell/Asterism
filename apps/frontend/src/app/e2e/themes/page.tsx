import { notFound } from "next/navigation";
import { ThemeEditor } from "@/features/settings/ui/admin-settings/theme-editor";

export default function ThemeTestPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return (
    <main className="flex h-dvh flex-col p-4">
      <ThemeEditor />
    </main>
  );
}
