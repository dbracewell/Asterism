import { notFound } from "next/navigation";
import { ChatModelSessionHarness } from "./session-harness";
export default async function ChatModelSessionTestPage({
  searchParams,
}: {
  searchParams: Promise<{
    draft?: string;
    timezone?: string;
    thinking?: string;
    header?: string;
    learner?: string;
  }>;
}) {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  const { draft, timezone, thinking, header, learner } = await searchParams;
  return (
    <ChatModelSessionHarness
      draft={draft === "true"}
      timezone={timezone ?? "UTC"}
      showThinking={thinking === "true"}
      showHeader={header === "true"}
      newLearner={learner === "new"}
    />
  );
}
