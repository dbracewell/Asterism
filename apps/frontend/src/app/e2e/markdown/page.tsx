import { notFound } from "next/navigation";
import { MarkdownHarness } from "./markdown-harness";

export default function MarkdownTestPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <MarkdownHarness />;
}
