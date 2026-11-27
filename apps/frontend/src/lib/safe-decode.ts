/**
 * `decodeURIComponent` that returns null for malformed input such as `%ZZ` or
 * a lone `%`, instead of throwing a URIError that fails the whole render
 * (US-117.2).
 */
export function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
