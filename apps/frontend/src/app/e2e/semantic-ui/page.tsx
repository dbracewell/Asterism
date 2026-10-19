import { notFound } from "next/navigation";
import { SemanticHarness } from "./semantic-harness";

export default function SemanticPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <SemanticHarness />;
}
