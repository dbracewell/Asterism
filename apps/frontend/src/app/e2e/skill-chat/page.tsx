import { notFound } from "next/navigation";
import { SkillChatHarness } from "./skill-chat-harness";
export default function SkillChatTestPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <SkillChatHarness />;
}
