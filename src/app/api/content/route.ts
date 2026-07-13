import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSessionId, errorResponse, requireSafeOrigin } from "@/server/security/request";
import { ContentInputSchema } from "@/server/services/content-service";
import { deleteContentCampaign } from "@/server/db/repository";
import { startAiOperation } from "@/server/operations/manager";

export const runtime = "nodejs";
export const maxDuration = 210;

export async function POST(request: Request) {
  try { await requireSafeOrigin(); const parsed = ContentInputSchema.parse(await request.json()); const input = { ...parsed, platforms: Array.from(new Set(parsed.platforms)) }; const operation = startAiOperation({ kind: "content_create", label: input.name, operationInput: input, originPath: "/content", targetKey: `content:create:${input.name.toLowerCase()}`, sessionId: await currentSessionId(), totalUnits: input.platforms.length, unitLabel: "platforms" }); return NextResponse.json({ operation }, { status: 202 }); }
  catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try { await requireSafeOrigin(); deleteContentCampaign(z.string().uuid().parse(new URL(request.url).searchParams.get("id"))); return NextResponse.json({ deleted: true }); }
  catch (error) { return errorResponse(error); }
}
