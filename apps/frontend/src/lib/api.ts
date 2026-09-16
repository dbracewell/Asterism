import { authClient } from "@/lib/auth-client";
import { BACKEND_API_URL, browserApiUrl } from "@/lib/backend-url";
import { ApiClient } from "@/lib/client";
import { client } from "@/lib/client/client.gen";

client.setConfig({
  baseUrl:
    typeof window === "undefined"
      ? BACKEND_API_URL
      : browserApiUrl(window.location.origin),
  throwOnError: true,
});

client.interceptors.request.use(async (request) => {
  const { data } = await authClient.token();
  if (data?.token) {
    request.headers.set("Authorization", `Bearer ${data.token}`);
  }
  return request;
});

const api = new ApiClient({ client });

export { api, client };
