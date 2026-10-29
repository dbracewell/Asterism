import { QueryError } from "@/components/query-error";
import { EmptyState } from "@/components/empty-state";
import { useQuery } from "@tanstack/react-query";
import { skillAvailabilityOptions } from "../queries";

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
  return (
    <EmptyState
      className="flex-none items-start p-3 text-left"
      role="note"
      title={
        policy.data?.policy_enabled
          ? "Skill assignments available"
          : "Skill activation disabled by administrator"
      }
      description={
        policy.data?.policy_enabled
          ? "Type / in the chat input to use an assigned skill; skill text never grants tools or file access."
          : "You can still edit skills and save assignments, which take effect once an administrator enables activation."
      }
    />
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
