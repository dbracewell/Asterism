import { notFound } from "next/navigation";
import { InlineFilesHarness } from "./inline-files-harness";

export default function InlineFilesTestPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <InlineFilesHarness />;
}
