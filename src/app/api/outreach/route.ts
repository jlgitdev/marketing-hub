import { NextResponse } from "next/server";
import { currentSessionId, errorResponse, requireSafeOrigin } from "@/server/security/request";
import { OutreachInputSchema } from "@/server/services/outreach-service";
import { deleteOutreachCampaign, updateOutreachCampaign } from "@/server/db/repository";
import { z } from "zod";
import { startAiOperation } from "@/server/operations/manager";

export const runtime = "nodejs";
export const maxDuration = 210;

export async function POST(request: Request) {
  try {
    await requireSafeOrigin();
    const input = OutreachInputSchema.parse(await request.json());
    const operation = startAiOperation({ kind: "outreach_create", label: input.name, operationInput: input, originPath: "/leads", targetKey: `outreach:create:${input.name.toLowerCase()}`, sessionId: await currentSessionId(), totalUnits: input.leadIds.length, unitLabel: "recipients" });
    return NextResponse.json({ operation }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try { await requireSafeOrigin(); const input = z.object({ id: z.string().uuid(), subjectTemplate: z.string().max(500).optional(), bodyTemplate: z.string().max(20_000).optional(), callToAction: z.string().max(2000).optional(), previewText: z.string().max(1000).optional(), forwardableAnnouncement: z.string().max(10_000).optional(), status: z.enum(["draft", "reviewed"]).optional() }).parse(await request.json()); const { id, ...patch } = input; return NextResponse.json(updateOutreachCampaign(id, patch)); }
  catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try { await requireSafeOrigin(); deleteOutreachCampaign(z.string().uuid().parse(new URL(request.url).searchParams.get("id"))); return NextResponse.json({ deleted: true }); }
  catch (error) { return errorResponse(error); }
}
