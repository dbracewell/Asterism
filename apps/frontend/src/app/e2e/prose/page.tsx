import { notFound } from "next/navigation";
import { ProseHarness } from "./prose-harness";

export default function ProseTestPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <ProseHarness />;
}
