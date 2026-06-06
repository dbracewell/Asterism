import { readFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import path from "path";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const themeName = searchParams.get("name");
  const filePath = path.join(
    process.cwd(),
    "public",
    "themes",
    `${themeName}.json`,
  );
  try {
    const data = await readFile(filePath, "utf-8");
    return NextResponse.json(data, { status: 200 });
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return NextResponse.json(
        { message: `Theme does not exist: ${themeName}` },
        { status: 404 },
      );
    }
  }

  return NextResponse.json({ message: "Server Error" }, { status: 500 });
}
