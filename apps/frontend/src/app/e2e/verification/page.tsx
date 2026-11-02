import { notFound } from "next/navigation";
import { VerificationHarness } from "./verification-harness";

export default function VerificationTestPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return <VerificationHarness />;
}
