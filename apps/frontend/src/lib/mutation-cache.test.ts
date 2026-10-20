import { Mutation, QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { handleMutationSuccess } from "./mutation-cache";

describe("handleMutationSuccess", () => {
  it("invalidates all queries globally by default", () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
    } as unknown as QueryClient;

    const mutation = {
      meta: undefined,
    } as unknown as Mutation<unknown, unknown, unknown, unknown>;

    handleMutationSuccess(queryClient, mutation);

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith();
  });

  it("skips invalidation when skipGlobalInvalidation is true", () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
    } as unknown as QueryClient;

    const mutation = {
      meta: { skipGlobalInvalidation: true },
    } as unknown as Mutation<unknown, unknown, unknown, unknown>;

    handleMutationSuccess(queryClient, mutation);

    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it("invalidates only specified query keys when invalidates array is provided", () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
    } as unknown as QueryClient;

    const mutation = {
      meta: {
        invalidates: [
          ["chats", "list"],
          ["user", "settings"],
        ],
      },
    } as unknown as Mutation<unknown, unknown, unknown, unknown>;

    handleMutationSuccess(queryClient, mutation);

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ["chats", "list"],
    });
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ["user", "settings"],
    });
  });
});
