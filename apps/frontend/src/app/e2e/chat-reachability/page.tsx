import { notFound } from "next/navigation";
import { ChatReachabilityHarness } from "./reachability-harness";

export default function ChatReachabilityPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <ChatReachabilityHarness />;
}
