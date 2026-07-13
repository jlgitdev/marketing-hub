import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isPathInsideDataDirectory } from "@/server/config";
import { speakerSpotlightAssetStoragePath } from "@/server/db/repository";
import { errorResponse } from "@/server/security/request";
import { stripC2pa } from "@/server/images/strip-c2pa";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    const download = new URL(request.url).searchParams.get("download") === "1";
    const filePath = speakerSpotlightAssetStoragePath(id);
    if (!filePath || !isPathInsideDataDirectory(filePath) || !fs.existsSync(filePath)) return NextResponse.json({ error: "Speaker Spotlight asset not found." }, { status: 404 });
    const extension = path.extname(filePath).toLowerCase();
    const contentType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
    const output = stripC2pa(fs.readFileSync(filePath)).bytes;
    return new NextResponse(Uint8Array.from(output), { headers: { "Content-Type": contentType, "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${path.basename(filePath)}"`, "Cache-Control": "private, max-age=3600", "X-Content-Credentials": "removed" } });
  } catch (error) { return errorResponse(error); }
}
