import { readCatalogTheme } from "@/features/theme/server/catalog";
import { ThemeRepositoryError } from "@/features/theme/server/repository";
import { themeIdSchema } from "@/features/theme/schemas";
import { NextRequest, NextResponse } from "next/server";

// Public palette data is also needed on the sign-in/setup screens.
export async function GET(request: NextRequest) {
  const id = themeIdSchema.safeParse(
    new URL(request.url).searchParams.get("name"),
  );
  if (!id.success)
    return NextResponse.json({ message: "Invalid theme ID" }, { status: 400 });
  try {
    return NextResponse.json(await readCatalogTheme(id.data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status =
      error instanceof ThemeRepositoryError && error.code === "NOT_FOUND"
        ? 404
        : 500;
    return NextResponse.json(
      { message: status === 404 ? "Unknown theme" : "Unable to read theme" },
      { status },
    );
  }
}

export const dynamic = "force-dynamic";
