import { ApiClient } from "@/client";
import { client } from "@/client/client.gen";
import { authClient } from "@/lib/auth-client";

client.setConfig({
  baseUrl: process.env.NEXT_PUBLIC_BACKEND_API_URL!,
});

client.interceptors.request.use(async (request) => {
  const { data } = await authClient.token();
  if (data?.token) {
    request.headers.set("Authorization", `Bearer ${data.token}`);
  }
  return request;
});

const api = new ApiClient({ client });

export { api };
