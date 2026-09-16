// Fixed internal topology in both local development and the combined container.
export const BACKEND_API_URL = "http://127.0.0.1:8000/api/py";

export function browserApiUrl(origin: string): string {
  return new URL("/api/py", origin).toString();
}

export function chatWebSocketUrl(
  origin: string,
  chatId: string,
  token: string,
): string {
  const url = new URL(`/api/py/chat/stream/${chatId}`, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
}
