import { notFound } from "next/navigation";
import { ChatFileScopeHarness } from "./scope-harness";
import { FileE2EHarness } from "./file-e2e-harness";

export default async function FileE2EPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; chat?: string; file?: string }>;
}) {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  const params = await searchParams;
  return params.scope ? (
    <ChatFileScopeHarness
      workspace={params.scope}
      chat={params.chat}
      file={params.file}
    />
  ) : (
    <FileE2EHarness />
  );
}
