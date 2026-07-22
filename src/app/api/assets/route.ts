import fs from "node:fs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { brandAssetStoragePath, deleteBrandAsset, updateBrandAsset } from "@/server/db/repository";
import { errorResponse, requireSafeOrigin } from "@/server/security/request";
import { validateAssetUpload } from "@/server/security/validation";
import { storeBrandAsset } from "@/server/storage/assets";
import { isPathInsideDataDirectory } from "@/server/config";
import { stripC2pa } from "@/server/images/strip-c2pa";
import { renderWebpPreview } from "@/server/images/preview";
import { runInWorkspace } from "@/server/workspaces/registry";

export const runtime = "nodejs";
const WorkspaceIdSchema = z.string().min(1).max(80);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = z.string().uuid().parse(url.searchParams.get("id"));
    const workspaceId = WorkspaceIdSchema.parse(url.searchParams.get("workspaceId"));
    const stored = runInWorkspace(workspaceId, () => {
      const filePath = brandAssetStoragePath(id);
      if (!filePath || !isPathInsideDataDirectory(filePath)) return null;
      return { filePath, output: stripC2pa(fs.readFileSync(filePath)).bytes };
    });
    if (!stored) return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    const preview = url.searchParams.get("preview") === "1";
    const response = preview ? await renderWebpPreview(stored.output, 128) : stored.output;
    return new NextResponse(Uint8Array.from(response), { headers: { "Content-Type": preview ? "image/webp" : stored.filePath.endsWith(".png") ? "image/png" : stored.filePath.endsWith(".webp") ? "image/webp" : "image/jpeg", "Cache-Control": "private, max-age=3600", "X-Content-Credentials": "removed" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    await requireSafeOrigin(request);
    const form = await request.formData();
    const workspaceId = WorkspaceIdSchema.parse(form.get("workspaceId"));
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose an image file.");
    return await runInWorkspace(workspaceId, async () => {
      const issue = validateAssetUpload(file);
      if (issue) throw new Error(issue);
      const title = z.string().min(1).max(160).parse(form.get("title") || file.name);
      const type = z.enum(["logo", "event_art", "visual_reference", "partner_mark", "assistant_attachment"]).parse(form.get("type") || "visual_reference");
      const asset = await storeBrandAsset({ title, type, fileName: file.name, mimeType: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
      if (request.signal.aborted && asset.type === "assistant_attachment") {
        deleteBrandAsset(asset.id);
        throw new DOMException("The attachment upload was canceled.", "AbortError");
      }
      return NextResponse.json(asset, { status: 201 });
    });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    await requireSafeOrigin(request);
    const url = new URL(request.url);
    const id = z.string().uuid().parse(url.searchParams.get("id"));
    const workspaceId = WorkspaceIdSchema.parse(url.searchParams.get("workspaceId"));
    runInWorkspace(workspaceId, () => deleteBrandAsset(id));
    return NextResponse.json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try { await requireSafeOrigin(request); const input = z.object({ workspaceId: WorkspaceIdSchema, id: z.string().uuid(), active: z.boolean() }).parse(await request.json()); return NextResponse.json(runInWorkspace(input.workspaceId, () => updateBrandAsset(input.id, input.active))); }
  catch (error) { return errorResponse(error); }
}
