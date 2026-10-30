import { client } from "@/lib/api";
import { chatgptConnectionGetOptions } from "@/lib/client/@tanstack/react-query.gen";
import { queryOptions } from "@tanstack/react-query";

// Keep the generated query-key prefix for shared mutation invalidation while
// ensuring one user's connection state is never reused for another owner.
export function chatgptConnectionOptions(owner: string) {
  const options = chatgptConnectionGetOptions({ client });
  const ownerKey = { ...options.queryKey[0], owner };
  return queryOptions({
    ...options,
    queryKey: [ownerKey],
    staleTime: 0,
    retry: false,
  });
}
