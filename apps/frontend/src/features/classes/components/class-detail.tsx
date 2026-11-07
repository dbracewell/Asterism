"use client";

import { ListSkeleton } from "@/components/loading-skeletons";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { QueryError } from "@/components/query-error";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StudentInvites } from "@/features/classes/components/student-invites";
import { errorDetail } from "@/features/classes/error-detail";
import { client } from "@/lib/api";
import type { ClassMember, TaughtClass } from "@/lib/client";
import {
  classDeleteMutation,
  classGetOneOptions,
  classJoinCodeRotateMutation,
  classMemberAllowBackMutation,
  classMemberGetManyOptions,
  classMemberRemoveMutation,
  classUpdateMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

function Invite({ item }: { item: TaughtClass }) {
  const switchId = useId();
  const [copied, setCopied] = useState(false);
  const rotate = useMutation(classJoinCodeRotateMutation({ client }));
  const update = useMutation(classUpdateMutation({ client }));
  const path = { class_id: item.id };
  const copyLink = async () => {
    const link = `${window.location.origin}/classes?join=${item.join_code}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
  };
  return (
    <section aria-label="Join with a code" className="grid gap-3">
      <h2 className="text-lg font-medium">Class code</h2>
      <p className="text-sm">
        Students who already have an Asterism account join with this code.
      </p>
      <p
        aria-label="Class code"
        className="bg-muted rounded-surface w-fit p-3 font-mono text-lg tracking-widest"
      >
        {item.join_code}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={copyLink}>
          {copied ? "Link copied" : "Copy join link"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={rotate.isPending}
          onClick={() => {
            setCopied(false);
            rotate.mutate({ path });
          }}
        >
          Replace code
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">
        Replacing the code stops the old one working. Current students stay.
      </p>
      <div className="flex items-center gap-2 text-sm">
        <Switch
          id={switchId}
          checked={item.join_enabled}
          disabled={update.isPending}
          onCheckedChange={(join_enabled) =>
            update.mutate({ path, body: { join_enabled } })
          }
        />
        <label htmlFor={switchId}>Allow new students to join</label>
      </div>
      {(rotate.error || update.error) && (
        <p role="alert" className="text-destructive text-sm">
          {errorDetail(rotate.error ?? update.error, "Could not save.")}
        </p>
      )}
    </section>
  );
}

function Member({ classId, member }: { classId: string; member: ClassMember }) {
  const remove = useMutation(classMemberRemoveMutation({ client }));
  const allow = useMutation(classMemberAllowBackMutation({ client }));
  const path = { class_id: classId, student_id: member.user_id };
  const removed = member.removed_at != null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b py-2 text-sm">
      <span className="wrap-anywhere">
        {member.display_name}
        {removed && " (removed)"}
      </span>
      {removed ? (
        <Button
          type="button"
          variant="outline"
          aria-label={`Allow ${member.display_name} back`}
          disabled={allow.isPending}
          onClick={() => allow.mutate({ path })}
        >
          Allow back
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          aria-label={`Remove ${member.display_name}`}
          disabled={remove.isPending}
          onClick={() => remove.mutate({ path })}
        >
          Remove
        </Button>
      )}
      {(remove.error || allow.error) && (
        <p role="alert" className="text-destructive w-full">
          {errorDetail(remove.error ?? allow.error, "Could not save.")}
        </p>
      )}
    </li>
  );
}

function Roster({ classId }: { classId: string }) {
  const members = useQuery({
    ...classMemberGetManyOptions({
      client,
      path: { class_id: classId },
      query: { page_size: 100 },
    }),
    retry: false,
  });
  return (
    <section aria-label="Students" className="grid gap-3">
      <h2 className="text-lg font-medium">Students</h2>
      <p className="text-muted-foreground text-sm">
        You see names only, never students&apos; chats.
      </p>
      {members.isPending && <ListSkeleton label="Loading students" rows={3} />}
      {members.error && (
        <QueryError
          error={members.error}
          message="Could not load students."
          retry={members.refetch}
          isRetrying={members.isFetching}
        />
      )}
      {members.data?.items.length === 0 && (
        <p className="text-sm">Nobody has joined yet.</p>
      )}
      {members.data && members.data.items.length > 0 && (
        <ul>
          {members.data.items.map((member) => (
            <Member key={member.user_id} classId={classId} member={member} />
          ))}
        </ul>
      )}
      {members.data && members.data.total > members.data.items.length && (
        <p className="text-muted-foreground text-sm">
          Showing the first {members.data.items.length} of {members.data.total}.
        </p>
      )}
    </section>
  );
}

function DeleteClass({ item }: { item: TaughtClass }) {
  const router = useRouter();
  const remove = useMutation({
    ...classDeleteMutation({ client }),
    onSuccess: () => router.push("/classes"),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" className="w-fit">
          Delete class
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {item.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Students lose this class, and its code stops working. Their own
            chats and files are not affected. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => remove.mutate({ path: { class_id: item.id } })}
          >
            Delete class
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** An educator's view of one class (US-60.1). */
export function ClassDetail({ classId }: { classId: string }) {
  const item = useQuery({
    ...classGetOneOptions({ client, path: { class_id: classId } }),
    retry: false,
  });
  if (item.isPending) {
    return (
      <PageLayout>
        <ListSkeleton label="Loading class" rows={3} />
      </PageLayout>
    );
  }
  if (item.error) {
    return (
      <PageLayout>
        <QueryError
          error={item.error}
          message="This class isn't available."
          retry={item.refetch}
          isRetrying={item.isFetching}
        />
      </PageLayout>
    );
  }
  return (
    <PageLayout>
      <PageHeader
        title={item.data.name}
        description={item.data.description || undefined}
      />
      <Invite item={item.data} />
      <StudentInvites classId={classId} />
      <Roster classId={classId} />
      <DeleteClass item={item.data} />
    </PageLayout>
  );
}
