import { BACKEND_API_URL, browserApiUrl } from "@/lib/backend-url";
import { backendToken, forgetBackendToken } from "@/lib/backend-token";
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
  const token = await backendToken();
  if (token) {
    request.headers.set("Authorization", `Bearer ${token}`);
  }
  return request;
});

// A rejected token (expired early, or the account changed) is fetched afresh next time.
client.interceptors.response.use((response) => {
  if (response.status === 401) forgetBackendToken();
  return response;
});

const api = new ApiClient({ client });

export { api, client };
