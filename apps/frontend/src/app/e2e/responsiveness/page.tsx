import { notFound } from "next/navigation";
import { ResponsivenessHarness } from "./responsiveness-harness";

export default function ResponsivenessPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <ResponsivenessHarness />;
}
