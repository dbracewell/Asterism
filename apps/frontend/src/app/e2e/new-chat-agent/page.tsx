import { notFound } from "next/navigation";
import { NewChatAgentE2eHarness } from "./new-chat-agent-e2e-harness";

export default function NewChatAgentE2EPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <NewChatAgentE2eHarness />;
}
