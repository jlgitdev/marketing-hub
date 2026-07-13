import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isPathInsideDataDirectory } from "@/server/config";
import { deleteGeneratedAsset, generatedAssetStoragePath } from "@/server/db/repository";
import { errorResponse, requireSafeOrigin } from "@/server/security/request";
import { stripC2pa } from "@/server/images/strip-c2pa";

export async function GET(request: Request) {
  try {
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    const download = new URL(request.url).searchParams.get("download") === "1";
    const filePath = generatedAssetStoragePath(id);
    if (!filePath || !isPathInsideDataDirectory(filePath)) return NextResponse.json({ error: "Generated asset not found." }, { status: 404 });
    const output = stripC2pa(fs.readFileSync(filePath)).bytes;
    return new NextResponse(Uint8Array.from(output), { headers: { "Content-Type": "image/png", "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${path.basename(filePath)}"`, "Cache-Control": "private, max-age=3600", "X-Content-Credentials": "removed" } });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try { await requireSafeOrigin(); deleteGeneratedAsset(z.string().uuid().parse(new URL(request.url).searchParams.get("id"))); return NextResponse.json({ deleted: true }); }
  catch (error) { return errorResponse(error); }
}
