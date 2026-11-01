import { HelpAudienceProvider } from "@/features/help/components/help-audience";
import { HelpCenter } from "@/features/help/components/help-center";
import { HelpTopic } from "@/features/help/components/help-topic";
import { helpEntries, type HelpId } from "@/features/help/registry";
import { notFound } from "next/navigation";

const ids = Object.keys(helpEntries) as HelpId[];

/**
 * The help center beside a trigger for every help entry, so the E2E check can
 * follow each popover's help center link. `?audience=admin` shows admin help.
 */
export default async function HelpCenterTestPage({
  searchParams,
}: {
  searchParams: Promise<{ audience?: string }>;
}) {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  const { audience } = await searchParams;
  return (
    <HelpAudienceProvider isAdmin={audience === "admin"}>
      <div className="h-dvh overflow-y-auto">
        <ul aria-label="Help triggers" className="flex flex-wrap gap-1 p-4">
          {ids.map((id) => (
            <li key={id}>
              <HelpTopic id={id} side="bottom" />
            </li>
          ))}
        </ul>
        <HelpCenter />
      </div>
    </HelpAudienceProvider>
  );
}
