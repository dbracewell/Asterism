import { readGuideImage } from "@/features/guide/server/guide-files";

/** A user guide screenshot from `docs/guide/images` (US-90.9). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const image = await readGuideImage(name);
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
