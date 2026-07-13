import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSessionId, errorResponse, requireSafeOrigin } from "@/server/security/request";
import { startAiOperation } from "@/server/operations/manager";

const Schema = z.object({ campaignId: z.string().uuid(), platform: z.enum(["x", "linkedin", "instagram"]), prompt: z.string().min(5).max(3000), headline: z.string().max(60), subheadline: z.string().max(96), footer: z.string().max(116), logoAssetId: z.string().uuid().nullable().optional(), logoPlacement: z.enum(["top_left", "top_right", "bottom_left", "bottom_right"]).default("top_right"), baseAssetId: z.string().uuid().nullable().optional() });

export const runtime = "nodejs";
export const maxDuration = 210;

export async function POST(request: Request) {
  try { await requireSafeOrigin(); const input = Schema.parse(await request.json()); const operation = startAiOperation({ kind: "content_image", label: "Generate campaign graphic", operationInput: input, originPath: "/content", targetKey: `content:image:${input.campaignId}`, sessionId: await currentSessionId() }); return NextResponse.json({ operation }, { status: 202 }); }
  catch (error) { return errorResponse(error); }
}
