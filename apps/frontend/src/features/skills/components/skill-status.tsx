import { QueryError } from "@/components/query-error";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import Link from "next/link";
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
          ? "A skill shows up in chat only after you assign it to your main agent under Agents. Then type / in the chat input to use it. Skill text never grants tools or file access."
          : "A skill must be assigned to your main agent under Agents before chats can use it. You can still edit skills and save assignments; they take effect once an administrator enables activation."
      }
      action={
        <Button variant="outline" size="sm" asChild className="w-fit">
          <Link href="/settings?t=user&setting=agents">
            Assign skills to your main agent
          </Link>
        </Button>
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
