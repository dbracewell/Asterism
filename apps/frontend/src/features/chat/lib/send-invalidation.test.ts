import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { handleMutationSuccess } from "@/lib/mutation-cache";
import { MESSAGE_SEND_INVALIDATES } from "./send-invalidation";

const key = (id: string, extra: object = {}) => [
  { _id: id, baseUrl: "", ...extra },
];

describe("sending a message (US-117.2)", () => {
  it("refreshes the chat queries it changes and leaves the rest cached", async () => {
    const client = new QueryClient();
    const changed = [
      key("chatSessionGetOne", { path: { chat_id: "c1" } }),
      key("chatSessionGetMany", { query: { project_id: "p" } }),
      key("usageGetMine"),
    ];
    const untouched = [key("appSettingsGet"), key("projectGetMany")];
    for (const queryKey of [...changed, ...untouched])
      client.setQueryData(queryKey, { ok: true });

    handleMutationSuccess(client, {
      meta: { invalidates: MESSAGE_SEND_INVALIDATES },
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    for (const queryKey of changed)
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
    for (const queryKey of untouched)
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
  });
});
