import { HtmlPreview } from "@/features/canvas/components/html-preview";
import { notFound } from "next/navigation";

// US-86.5: an HTML canvas page runs its own inline script inside the preview
// frame under the app's CSP, and still reaches no network.
const PAGE = `<h1 id="status">Script did not run</h1>
<script>
  document.getElementById("status").textContent = "Script ran";
  fetch("/api/py/settings/user").then(
    () => (document.title = "network reached"),
    () => (document.title = "network blocked"),
  );
</script>`;

export default function CanvasPreviewTestPage() {
  if (process.env.ASTERISM_CONFIG_PROFILE !== "test") notFound();
  return (
    <main className="h-screen p-4">
      <HtmlPreview content={PAGE} title="Script page" />
    </main>
  );
}
