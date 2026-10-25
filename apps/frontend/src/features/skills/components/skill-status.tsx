import { QueryError } from "@/components/query-error";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
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
    <Empty className="flex-none items-start p-3 text-left" role="note">
      <EmptyHeader>
        <EmptyTitle>
          {policy.data?.policy_enabled
            ? "Skill assignments available"
            : "Skill activation disabled by administrator"}
        </EmptyTitle>
        <EmptyDescription>
          You can edit your skills and save assignments.{" "}
          {policy.data?.policy_enabled
            ? "Only assigned skills are eligible."
            : "Assignments remain saved while activation is disabled."}{" "}
          Use / in the chat input to activate assigned skills. Skill text grants
          no tools or file access.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
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
      : "Please retry.";
  return (
    <Empty role="alert" className="flex-none items-start p-3 text-left">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{detail}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
