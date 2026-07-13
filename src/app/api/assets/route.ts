import fs from "node:fs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { brandAssetStoragePath, deleteBrandAsset, updateBrandAsset } from "@/server/db/repository";
import { errorResponse, requireSafeOrigin } from "@/server/security/request";
import { validateAssetUpload } from "@/server/security/validation";
import { storeBrandAsset } from "@/server/storage/assets";
import { isPathInsideDataDirectory } from "@/server/config";
import { stripC2pa } from "@/server/images/strip-c2pa";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    const filePath = brandAssetStoragePath(id);
    if (!filePath || !isPathInsideDataDirectory(filePath)) return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    const output = stripC2pa(fs.readFileSync(filePath)).bytes;
    return new NextResponse(Uint8Array.from(output), { headers: { "Content-Type": filePath.endsWith(".png") ? "image/png" : filePath.endsWith(".webp") ? "image/webp" : "image/jpeg", "Cache-Control": "private, max-age=3600", "X-Content-Credentials": "removed" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    await requireSafeOrigin();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose an image file.");
    const issue = validateAssetUpload(file);
    if (issue) throw new Error(issue);
    const title = z.string().min(1).max(160).parse(form.get("title") || file.name);
    const type = z.enum(["logo", "event_art", "visual_reference", "partner_mark"]).parse(form.get("type") || "visual_reference");
    const asset = await storeBrandAsset({ title, type, fileName: file.name, mimeType: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
    return NextResponse.json(asset, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    await requireSafeOrigin();
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    deleteBrandAsset(id);
    return NextResponse.json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try { await requireSafeOrigin(); const input = z.object({ id: z.string().uuid(), active: z.boolean() }).parse(await request.json()); return NextResponse.json(updateBrandAsset(input.id, input.active)); }
  catch (error) { return errorResponse(error); }
}
