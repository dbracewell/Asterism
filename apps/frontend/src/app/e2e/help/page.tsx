import { HelpTopic } from "@/features/help/components/help-topic";
import { notFound } from "next/navigation";

export default function HelpTestPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return (
    <main className="flex h-dvh flex-col gap-4 p-4">
      <p className="flex items-center gap-1">
        Persona <HelpTopic id="concept.persona" />
      </p>
      <p className="flex items-center gap-1">
        Tools <HelpTopic id="admin.tools" />
      </p>
    </main>
  );
}
