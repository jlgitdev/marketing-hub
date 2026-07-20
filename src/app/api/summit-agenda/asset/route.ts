import fs from "node:fs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { summitAgendaAssetStoragePath } from "@/server/db/repository";
import { stripC2pa } from "@/server/images/strip-c2pa";
import { renderWebpPreview } from "@/server/images/preview";
import { errorResponse } from "@/server/security/request";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = z.string().uuid().parse(url.searchParams.get("id"));
    const filePath = summitAgendaAssetStoragePath(id);
    if (!filePath || !fs.existsSync(filePath)) return NextResponse.json({ error: "Agenda image not found." }, { status: 404 });
    const image = stripC2pa(fs.readFileSync(filePath)).bytes;
    const preview = url.searchParams.get("preview") === "1";
    const output = preview ? await renderWebpPreview(image, 720) : image;
    const headers: Record<string, string> = { "Content-Type": preview ? "image/webp" : "image/png", "Cache-Control": "private, max-age=3600" };
    if (url.searchParams.get("download") === "1") headers["Content-Disposition"] = `attachment; filename="agi-summit-live-${id.slice(0, 8)}.png"`;
    return new NextResponse(new Uint8Array(output), { headers });
  } catch (error) { return errorResponse(error, 404); }
}
