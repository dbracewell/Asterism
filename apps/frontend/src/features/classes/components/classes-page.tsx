"use client";

import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/loading-skeletons";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { errorDetail } from "@/features/classes/error-detail";
import { client } from "@/lib/api";
import {
  classCreateMutation,
  classGetManyOptions,
  classJoinedGetManyOptions,
  classJoinMutation,
  classLeaveMutation,
  educatorAccessGetOptions,
  educatorAccessRequestMutation,
} from "@/lib/client/@tanstack/react-query.gen";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";

function JoinClass({ initialCode }: { initialCode: string }) {
  const id = useId();
  const [code, setCode] = useState(initialCode);
  const [joined, setJoined] = useState("");
  const join = useMutation({
    ...classJoinMutation({ client }),
    onSuccess: (item) => {
      setCode("");
      setJoined(item.name);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setJoined("");
    join.mutate({ body: { code } });
  };
  return (
    <form className="grid max-w-md gap-3" onSubmit={submit}>
      <Field>
        <FieldLabel htmlFor={id}>Class code</FieldLabel>
        <Input
          id={id}
          value={code}
          autoComplete="off"
          onChange={(event) => setCode(event.target.value)}
        />
      </Field>
      <p className="text-muted-foreground text-sm">
        Your educator will see your name. They can&apos;t see your chats.
      </p>
      {join.error && (
        <p role="alert" className="text-destructive text-sm">
          {errorDetail(join.error, "Could not join. Try again.")}
        </p>
      )}
      {joined && (
        <p role="status" className="text-sm wrap-anywhere">
          You joined {joined}.
        </p>
      )}
      <div>
        <Button type="submit" disabled={!code.trim() || join.isPending}>
          {join.isPending ? "Joining..." : "Join class"}
        </Button>
      </div>
    </form>
  );
}

function JoinedClasses() {
  const classes = useQuery({
    ...classJoinedGetManyOptions({ client, query: { page_size: 100 } }),
    retry: false,
  });
  const leave = useMutation(classLeaveMutation({ client }));
  if (classes.isPending) {
    return <ListSkeleton label="Loading your classes" rows={2} detail />;
  }
  if (classes.error) {
    return (
      <QueryError
        error={classes.error}
        message="Could not load your classes."
        retry={classes.refetch}
        isRetrying={classes.isFetching}
      />
    );
  }
  if (classes.data.items.length === 0) {
    return (
      <EmptyState
        className="rounded-surface border p-8"
        title="No classes yet"
        description="Enter a class code from your educator to join."
      />
    );
  }
  return (
    <div className="grid gap-3">
      {leave.error && (
        <p role="alert" className="text-destructive text-sm">
          {errorDetail(leave.error, "Could not leave the class.")}
        </p>
      )}
      {classes.data.items.map((item) => (
        <Card key={item.id}>
          <CardHeader>
            <CardTitle className="text-base wrap-anywhere">
              {item.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid min-w-0 gap-1 text-sm">
              <p className="wrap-anywhere">Run by {item.educator_name}</p>
              {item.description && (
                <p className="text-muted-foreground wrap-anywhere">
                  {item.description}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              aria-label={`Leave ${item.name}`}
              disabled={leave.isPending}
              onClick={() => leave.mutate({ path: { class_id: item.id } })}
            >
              Leave
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CreateClass() {
  const prefix = useId();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutation({
    ...classCreateMutation({ client }),
    onSuccess: (item) => router.push(`/classes/${item.id}`),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({ body: { name, description } });
  };
  return (
    <form className="grid max-w-md gap-3" onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${prefix}-name`}>Class name</FieldLabel>
          <Input
            id={`${prefix}-name`}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefix}-description`}>Description</FieldLabel>
          <Textarea
            id={`${prefix}-description`}
            value={description}
            maxLength={2000}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </FieldGroup>
      {create.error && (
        <p role="alert" className="text-destructive text-sm">
          {errorDetail(create.error, "Could not create the class.")}
        </p>
      )}
      <div>
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          {create.isPending ? "Creating..." : "Create class"}
        </Button>
      </div>
    </form>
  );
}

function TaughtClasses() {
  const classes = useQuery({
    ...classGetManyOptions({ client, query: { page_size: 100 } }),
    retry: false,
  });
  if (classes.isPending) {
    return <ListSkeleton label="Loading classes you teach" rows={2} detail />;
  }
  if (classes.error) {
    return (
      <QueryError
        error={classes.error}
        message="Could not load the classes you teach."
        retry={classes.refetch}
        isRetrying={classes.isFetching}
      />
    );
  }
  return (
    <div className="grid gap-3">
      {classes.data.items.map((item) => (
        <Card key={item.id}>
          <CardHeader>
            <CardTitle className="text-base wrap-anywhere">
              <Link className="underline" href={`/classes/${item.id}`}>
                {item.name}
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            {item.member_count}{" "}
            {item.member_count === 1 ? "student" : "students"}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Teaching() {
  const access = useQuery({
    ...educatorAccessGetOptions({ client }),
    retry: false,
  });
  const request = useMutation(educatorAccessRequestMutation({ client }));
  if (access.isPending) {
    return <ListSkeleton label="Checking educator access" rows={1} />;
  }
  if (access.error) {
    return (
      <QueryError
        error={access.error}
        message="Could not check educator access."
        retry={access.refetch}
        isRetrying={access.isFetching}
      />
    );
  }
  if (access.data.status === "approved") {
    return (
      <div className="grid gap-6">
        <TaughtClasses />
        <CreateClass />
      </div>
    );
  }
  if (access.data.status === "pending") {
    return (
      <p role="status" className="text-sm">
        Your request is waiting for an administrator.
      </p>
    );
  }
  return (
    <div className="grid max-w-md justify-items-start gap-3 text-sm">
      <p>
        Educators create classes and share a code with their students. Asking
        sends your name and email to your administrator.
      </p>
      {request.error && (
        <p role="alert" className="text-destructive">
          {errorDetail(request.error, "Could not send the request.")}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={request.isPending}
        onClick={() => request.mutate({})}
      >
        Request educator access
      </Button>
    </div>
  );
}

/** Joining and teaching classes in one place (US-60.1). */
export function ClassesPage({ initialCode }: { initialCode: string }) {
  return (
    <PageLayout>
      <PageHeader
        title="Classes"
        description="Join a class, or run one for your students."
      />
      <section aria-label="Join a class" className="grid gap-3">
        <h2 className="text-lg font-medium">Join a class</h2>
        <JoinClass initialCode={initialCode} />
      </section>
      <section aria-label="Your classes" className="grid gap-3">
        <h2 className="text-lg font-medium">Your classes</h2>
        <JoinedClasses />
      </section>
      <section aria-label="Teaching" className="grid gap-3">
        <h2 className="text-lg font-medium">Teaching</h2>
        <Teaching />
      </section>
    </PageLayout>
  );
}
