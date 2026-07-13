import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSessionId, errorResponse, requireSafeOrigin } from "@/server/security/request";
import { startAiOperation } from "@/server/operations/manager";

export const runtime = "nodejs";
export const maxDuration = 210;

const Schema = z.object({ campaignId: z.string().uuid(), recipientId: z.string().uuid().nullable().default(null) });

export async function POST(request: Request) {
  try { await requireSafeOrigin(); const input = Schema.parse(await request.json()); const operation = startAiOperation({ kind: "outreach_regenerate", label: input.recipientId ? "Regenerate recipient draft" : "Regenerate outreach campaign", operationInput: input, originPath: "/leads", targetKey: `outreach:regenerate:${input.recipientId || input.campaignId}`, sessionId: await currentSessionId() }); return NextResponse.json({ operation }, { status: 202 }); }
  catch (error) { return errorResponse(error); }
}
