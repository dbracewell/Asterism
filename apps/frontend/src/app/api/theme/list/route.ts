import type { Theme } from "@/lib/theme";
import * as fs from "fs/promises";
import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import path from "path";

export async function GET() {
  const filePath = path.join(process.cwd(), "public", "themes");
  try {
    const files = await fs.readdir(filePath);
    const themeNames: Theme[] = [];
    for (const file of files) {
      const data = JSON.parse(
        await readFile(path.join(filePath, file), "utf-8"),
      );
      themeNames.push({ name: data.name, filename: file.replace(".json", "") });
    }
    return NextResponse.json(themeNames, { status: 200 });
  } catch (error: unknown) {
    console.log(error);
    return NextResponse.json([], { status: 500 });
  }
}
