/** How long the object URL lives once the download has started. */
const REVOKE_AFTER_MS = 60_000;

/**
 * Hands a blob to the browser as a file. Every download in the app goes
 * through here (US-117.2). The link is attached so Firefox follows it, and the
 * object URL is revoked a minute later: revoking at once can cancel the
 * download in some browsers.
 */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  }
}
