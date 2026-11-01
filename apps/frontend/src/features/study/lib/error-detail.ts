/** Server error text: a domain `detail` string or the first validation message. */
export function studyErrorDetail(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "detail" in error) {
    const { detail } = error;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && typeof detail[0]?.msg === "string")
      return detail[0].msg as string;
  }
  return fallback;
}
