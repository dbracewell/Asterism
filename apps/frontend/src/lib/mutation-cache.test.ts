import {
  type Mutation,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { handleMutationSuccess } from "./mutation-cache";

const mutation = (meta?: unknown) =>
  ({ meta }) as unknown as Mutation<unknown, unknown, unknown, unknown>;

/** A query whose fetches resolve only when told to, with an active observer. */
function deferredQuery(client: QueryClient, queryKey: string[]) {
  const pending: ((value: string) => void)[] = [];
  const queryFn = vi.fn(
    () => new Promise<string>((resolve) => pending.push(resolve)),
  );
  const observer = new QueryObserver(client, { queryKey, queryFn });
  const unsubscribe = observer.subscribe(() => {});
  return { queryFn, pending, unsubscribe };
}

const data = (client: QueryClient, queryKey: string[]) =>
  client.getQueryData<string>(queryKey);

describe("handleMutationSuccess", () => {
  it("invalidates all queries globally by default", async () => {
    const client = new QueryClient();
    client.setQueryData(["a"], 1);
    client.setQueryData(["b"], 2);
    handleMutationSuccess(client, mutation());
    await vi.waitFor(() =>
      expect(client.getQueryState(["a"])?.isInvalidated).toBe(true),
    );
    expect(client.getQueryState(["b"])?.isInvalidated).toBe(true);
  });

  it("skips invalidation when skipGlobalInvalidation is true", async () => {
    const client = new QueryClient();
    client.setQueryData(["a"], 1);
    handleMutationSuccess(client, mutation({ skipGlobalInvalidation: true }));
    await Promise.resolve();
    expect(client.getQueryState(["a"])?.isInvalidated).toBe(false);
  });

  it("invalidates only specified query keys when invalidates array is provided", async () => {
    const client = new QueryClient();
    for (const key of ["chats", "user", "other"]) client.setQueryData([key], 1);
    handleMutationSuccess(
      client,
      mutation({ invalidates: [["chats"], ["user"]] }),
    );
    await vi.waitFor(() =>
      expect(client.getQueryState(["user"])?.isInvalidated).toBe(true),
    );
    expect(client.getQueryState(["chats"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["other"])?.isInvalidated).toBe(false);
  });

  it("refetches a first load that started before the mutation, not keep its stale answer", async () => {
    const client = new QueryClient();
    const list = deferredQuery(client, ["joined"]);
    await vi.waitFor(() => expect(list.queryFn).toHaveBeenCalledTimes(1));

    handleMutationSuccess(client, mutation());
    await vi.waitFor(() => expect(list.queryFn).toHaveBeenCalledTimes(2));
    list.pending[0]!("before the join");
    list.pending[1]!("after the join");
    await vi.waitFor(() =>
      expect(data(client, ["joined"])).toBe("after the join"),
    );
    list.unsubscribe();
  });

  it("leaves first loads of other keys running", async () => {
    const client = new QueryClient();
    const other = deferredQuery(client, ["other"]);
    await vi.waitFor(() => expect(other.queryFn).toHaveBeenCalledTimes(1));

    handleMutationSuccess(client, mutation({ invalidates: [["chats"]] }));
    other.pending[0]!("loaded");
    await vi.waitFor(() => expect(data(client, ["other"])).toBe("loaded"));
    expect(other.queryFn).toHaveBeenCalledTimes(1);
    other.unsubscribe();
  });
});
