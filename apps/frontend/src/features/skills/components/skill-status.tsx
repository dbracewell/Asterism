import { QueryError } from "@/components/query-error";
import { EmptyState } from "@/components/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useQuery } from "@tanstack/react-query";
import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import { skillAvailabilityOptions } from "../queries";

/** The full-width activation notice above skill lists (US-75.2). */
export function SkillAvailability({ owner }: { owner: string }) {
  const policy = useQuery(skillAvailabilityOptions(owner));
  if (policy.isPending)
    return <p role="status">Checking skill activation policy…</p>;
  if (policy.error)
    return (
      <QueryError
        error={policy.error}
        message="Could not check skill activation policy."
        retry={policy.refetch}
        isRetrying={policy.isFetching}
      />
    );
  const enabled = policy.data?.policy_enabled;
  return (
    <Alert role="note" className="px-3 py-2">
      {enabled ? <InfoIcon aria-hidden /> : <TriangleAlertIcon aria-hidden />}
      <AlertTitle>
        {enabled
          ? "Assign a skill to use it in chat"
          : "Skill activation disabled by administrator"}
      </AlertTitle>
      <AlertDescription>
        {enabled
          ? "A skill shows up in chat only after you assign it to your main agent. Then type / in the chat input to use it. Skill text never grants tools or file access."
          : "You can still edit skills and assign them to your main agent. Assignments take effect once an administrator enables activation."}
      </AlertDescription>
    </Alert>
  );
}

export function SkillFailure({
  error,
  title,
}: {
  error: unknown;
  title: string;
}) {
  const detail =
    error &&
    typeof error === "object" &&
    "detail" in error &&
    typeof error.detail === "string"
      ? error.detail
      : "Retry, or reload the page if it keeps failing.";
  return (
    <EmptyState
      role="alert"
      className="flex-none items-start p-3 text-left"
      title={title}
      description={detail}
    />
  );
}
