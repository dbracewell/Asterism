import { authClient } from "@/lib/auth-client";
import { ApiClient } from "@/lib/client";
import { client } from "@/lib/client/client.gen";

client.setConfig({
  baseUrl: process.env.NEXT_PUBLIC_BACKEND_API_URL!,
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
