import { getAllThemes } from "@/features/theme/server/catalog";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const themes = await getAllThemes();
    return NextResponse.json(
      Object.values(themes).map(({ name, filename }) => ({ name, filename })),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { message: "Unable to list themes" },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
