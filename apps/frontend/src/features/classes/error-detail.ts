export function errorDetail(error: unknown, fallback: string) {
  return error &&
    typeof error === "object" &&
    "detail" in error &&
    typeof error.detail === "string"
    ? error.detail
    : fallback;
}
