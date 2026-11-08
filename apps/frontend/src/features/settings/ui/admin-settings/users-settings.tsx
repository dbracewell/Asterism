"use client";

import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/loading-skeletons";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { client } from "@/lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorDetail } from "@/features/classes/error-detail";
import type { Group, UserSummary } from "@/lib/client";
import {
  groupGetManyOptions,
  groupMemberMoveMutation,
  userGetManyOptions,
} from "@/lib/client/@tanstack/react-query.gen";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";

const PAGE_SIZE = 50;

function firstSeen(seconds: number) {
  return new Date(seconds * 1000).toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
}

function GroupControl({
  user,
  groups,
}: {
  user: UserSummary;
  groups: Group[] | undefined;
}) {
  const move = useMutation(groupMemberMoveMutation({ client }));
  const label = `Group for ${user.name ?? user.email ?? user.id}`;
  // The admin group follows the sign-in role (ADR-0058), so it isn't chosen here.
  if (user.group.id === "admin" || !groups) {
    return <Badge variant="outline">{user.group.name}</Badge>;
  }
  return (
    <span className="grid gap-1">
      <Select
        value={user.group.id}
        disabled={move.isPending}
        onValueChange={(group_id) =>
          move.mutate({ path: { user_id: user.id }, body: { group_id } })
        }
      >
        <SelectTrigger aria-label={label} size="sm" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {groups
            .filter((group) => group.id !== "admin")
            .map((group) => (
              <SelectItem key={group.id} value={group.id}>
                {group.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {move.error && (
        <span role="alert" className="text-destructive text-xs">
          {errorDetail(move.error, "Could not move this user.")}
        </span>
      )}
    </span>
  );
}

function Row({ user, groups }: { user: UserSummary; groups?: Group[] }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b py-2 text-sm">
      <span className="grid min-w-0 gap-0.5">
        <span className="wrap-anywhere">{user.name ?? "Unnamed user"}</span>
        <span className="text-muted-foreground wrap-anywhere">
          {user.email ?? user.id}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <GroupControl user={user} groups={groups} />
        {user.educator === "pending" && (
          <Badge variant="secondary">Educator request</Badge>
        )}
        <span className="text-muted-foreground">
          First seen {firstSeen(user.created_at)}
        </span>
      </span>
    </li>
  );
}

/** Who has an account (US-64.3) and which group they are in (US-70.3). */
export function UsersSettings() {
  const groups = useQuery({ ...groupGetManyOptions({ client }), retry: false });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const query = useDeferredValue(search.trim());
  const users = useQuery({
    ...userGetManyOptions({
      client,
      query: { search: query || undefined, page, page_size: PAGE_SIZE },
    }),
    placeholderData: keepPreviousData,
    retry: false,
  });
  return (
    <div className="grid max-w-2xl gap-3">
      <p className="text-sm">
        Everyone with an account and their group. Names and emails come from
        sign-in and update the next time each person uses Asterism. The admin
        role is managed in sign-in, and administrators are always in Admin.
      </p>
      <Input
        type="search"
        aria-label="Search users"
        placeholder="Search names, emails or IDs"
        maxLength={320}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
      />
      {users.isPending && <ListSkeleton label="Loading users" rows={5} />}
      {users.error && (
        <QueryError
          error={users.error}
          message={
            users.data
              ? "Could not refresh users. Showing saved results."
              : "Could not load users."
          }
          retry={users.refetch}
          isRetrying={users.isFetching}
        />
      )}
      {users.data && users.data.items.length === 0 && (
        <EmptyState
          title={query ? "No matching users" : "No users yet"}
          description={
            query
              ? "Try part of a name, email or user ID."
              : "Accounts appear here once they are created."
          }
        />
      )}
      {users.data && users.data.items.length > 0 && (
        <>
          <ul>
            {users.data.items.map((user) => (
              <Row key={user.id} user={user} groups={groups.data} />
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={page === 1 || users.isFetching}
              onClick={() => setPage(page - 1)}
            >
              Previous users
            </Button>
            <span className="text-muted-foreground text-sm">
              Page {page} · {users.data.total}{" "}
              {users.data.total === 1 ? "user" : "users"}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={
                page * PAGE_SIZE >= users.data.total || users.isFetching
              }
              onClick={() => setPage(page + 1)}
            >
              Next users
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
