import { ChatSearch } from "@/features/chat/components/chat-search";
import { notFound } from "next/navigation";

export default function ChatSearchE2EPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <ChatSearch />;
}
