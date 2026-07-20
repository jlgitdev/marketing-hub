import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireSafeOrigin } from "@/server/security/request";
import { resolveSummitAgendaPortrait, saveSummitAgendaPortrait } from "@/server/services/summit-agenda-service";
import { renderWebpPreview } from "@/server/images/preview";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = z.string().min(1).max(180).parse(url.searchParams.get("token"));
    const filePath = resolveSummitAgendaPortrait(token);
    if (!filePath) return NextResponse.json({ error: "Portrait not found." }, { status: 404 });
    const requestedSize = z.coerce.number().int().min(16).max(256).safeParse(url.searchParams.get("size"));
    if (requestedSize.success) {
      const preview = await renderWebpPreview(fs.readFileSync(filePath), requestedSize.data);
      return new NextResponse(new Uint8Array(preview), { headers: {
        "Content-Type": "image/webp",
        "Cache-Control": token.startsWith("default:") ? "public, max-age=31536000, immutable" : "private, max-age=31536000, immutable"
      } });
    }
    const extension = path.extname(filePath).toLowerCase();
    const type = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : extension === ".svg" ? "image/svg+xml" : "image/png";
    return new NextResponse(fs.readFileSync(filePath), { headers: { "Content-Type": type, "Cache-Control": token.startsWith("default:") ? "public, max-age=31536000, immutable" : "private, no-store" } });
  } catch (error) { return errorResponse(error, 404); }
}

export async function POST(request: Request) {
  try {
    await requireSafeOrigin();
    const form = await request.formData();
    const sessionId = z.string().min(1).max(240).parse(form.get("sessionId"));
    const personId = z.string().min(1).max(180).parse(form.get("personId"));
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a portrait image to upload.");
    return NextResponse.json({ agenda: await saveSummitAgendaPortrait({ sessionId, personId, file }) });
  } catch (error) { return errorResponse(error); }
}
