import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isPathInsideDataDirectory } from "@/server/config";
import { speakerSpotlightTemplateStorage } from "@/server/db/repository";
import { errorResponse } from "@/server/security/request";
import { stripC2pa } from "@/server/images/strip-c2pa";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = z.string().uuid().parse(url.searchParams.get("id"));
    const thumbnail = url.searchParams.get("thumbnail") !== "0";
    const storage = speakerSpotlightTemplateStorage(id);
    const filePath = storage ? (thumbnail ? storage.thumbnailPath : storage.storagePath) : null;
    if (!filePath || !isPathInsideDataDirectory(filePath) || !fs.existsSync(filePath)) return NextResponse.json({ error: "Speaker Spotlight template asset not found." }, { status: 404 });
    const output = stripC2pa(fs.readFileSync(filePath)).bytes;
    const contentType = path.extname(filePath).toLowerCase() === ".webp" ? "image/webp" : "image/png";
    return new NextResponse(Uint8Array.from(output), { headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600", "X-Content-Credentials": "removed" } });
  } catch (error) { return errorResponse(error); }
}
