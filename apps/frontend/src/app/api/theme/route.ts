import {
  readCatalogTheme,
  ThemeNotFoundError,
} from "@/features/theme/server/catalog";
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
    return NextResponse.json(await readCatalogTheme(id.data));
  } catch (error) {
    const status = error instanceof ThemeNotFoundError ? 404 : 500;
    return NextResponse.json(
      { message: status === 404 ? "Unknown theme" : "Unable to read theme" },
      { status },
    );
  }
}
