"use client";

import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { errorDetail } from "@/features/classes/error-detail";
import { client } from "@/lib/api";
import type { EducatorRequest } from "@/lib/client";
import {
  educatorRequestApproveMutation,
  educatorRequestDeleteMutation,
  educatorRequestGetManyOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";

function Row({ request }: { request: EducatorRequest }) {
  const approve = useMutation(educatorRequestApproveMutation({ client }));
  const remove = useMutation(educatorRequestDeleteMutation({ client }));
  const path = { user_id: request.user_id };
  const pending = request.status === "pending";
  const busy = approve.isPending || remove.isPending;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b py-2 text-sm">
      <span className="grid min-w-0 gap-0.5">
        <span className="wrap-anywhere">{request.display_name}</span>
        {request.email && (
          <span className="text-muted-foreground wrap-anywhere">
            {request.email}
          </span>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Badge variant={pending ? "secondary" : "default"}>
          {pending ? "Waiting" : "Educator"}
        </Badge>
        {pending && (
          <Button
            type="button"
            aria-label={`Approve ${request.display_name}`}
            disabled={busy}
            onClick={() => approve.mutate({ path })}
          >
            Approve
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          aria-label={`${pending ? "Deny" : "Revoke"} ${request.display_name}`}
          disabled={busy}
          onClick={() => remove.mutate({ path })}
        >
          {pending ? "Deny" : "Revoke"}
        </Button>
      </span>
      {(approve.error || remove.error) && (
        <p role="alert" className="text-destructive w-full">
          {errorDetail(approve.error ?? remove.error, "Could not save.")}
        </p>
      )}
    </li>
  );
}

/** Decides who may run classes (US-60.1). Educators are not administrators. */
export function EducatorSettings() {
  const requests = useQuery({
    ...educatorRequestGetManyOptions({ client, query: { page_size: 100 } }),
    retry: false,
  });
  return (
    <div className="grid max-w-2xl gap-3">
      <p className="text-sm">
        Educators can create classes and see the names of students who join.
        They can&apos;t see students&apos; chats, and they get no admin access.
        Revoking stops someone managing their classes; students stay in them.
      </p>
      {requests.isPending && <ListSkeleton label="Loading requests" rows={3} />}
      {requests.error && (
        <QueryError
          error={requests.error}
          message="Could not load educator requests."
          retry={requests.refetch}
          isRetrying={requests.isFetching}
        />
      )}
      {requests.data?.items.length === 0 && (
        <p className="text-sm">
          Nobody has asked yet. Users ask from the Classes page.
        </p>
      )}
      {requests.data && requests.data.items.length > 0 && (
        <ul>
          {requests.data.items.map((request) => (
            <Row key={request.user_id} request={request} />
          ))}
        </ul>
      )}
    </div>
  );
}
