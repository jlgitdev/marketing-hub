import { NextResponse } from "next/server";
import { currentSessionId, errorResponse, requireSafeOrigin } from "@/server/security/request";
import { ResearchInputSchema } from "@/server/services/research-service";
import { z } from "zod";
import { deleteResearchRun } from "@/server/db/repository";
import { startAiOperation } from "@/server/operations/manager";

export const runtime = "nodejs";
export const maxDuration = 330;

export async function POST(request: Request) {
  try {
    await requireSafeOrigin();
    const input = ResearchInputSchema.parse(await request.json());
    const operation = startAiOperation({ kind: "research", label: input.name, operationInput: input, originPath: "/leads", targetKey: `research:${input.name.toLowerCase()}:${input.region.toLowerCase()}`, sessionId: await currentSessionId() });
    return NextResponse.json({ operation }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try { await requireSafeOrigin(); deleteResearchRun(z.string().uuid().parse(new URL(request.url).searchParams.get("id"))); return NextResponse.json({ deleted: true }); }
  catch (error) { return errorResponse(error); }
}
