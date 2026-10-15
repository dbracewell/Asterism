import { notFound } from "next/navigation";
import { ChatModelsHarness } from "./chat-models-harness";
export default function ChatModelsPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <ChatModelsHarness />;
}
