import { notFound } from "next/navigation";
import { ChatModelSessionHarness } from "./session-harness";
export default async function ChatModelSessionTestPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return (
    <ChatModelSessionHarness draft={(await searchParams).draft === "true"} />
  );
}
