import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSessionId, errorResponse, requireSafeOrigin } from "@/server/security/request";
import { deleteSummitAgendaBatch } from "@/server/db/repository";
import {
  getSummitAgendaView,
  resetSummitAgendaSession,
  SummitAgendaGenerateSchema,
  SummitAgendaSessionUpdateSchema,
  updateSummitAgendaSession
} from "@/server/services/summit-agenda-service";
import { startAiOperation } from "@/server/operations/manager";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function GET(request: Request) {
  const parsed = z.string().uuid().safeParse(new URL(request.url).searchParams.get("batch"));
  return NextResponse.json(getSummitAgendaView(parsed.success ? parsed.data : null));
}

export async function POST(request: Request) {
  try {
    await requireSafeOrigin();
    const input = SummitAgendaGenerateSchema.parse(await request.json());
    const sessionIds = [...new Set(input.sessionIds)];
    const operation = startAiOperation({
      kind: "summit_agenda_batch",
      label: sessionIds.length === 1 ? "Live agenda post" : `Live agenda posts · ${sessionIds.length} sessions`,
      operationInput: { sessionIds }, originPath: "/summit-agenda",
      targetKey: `summit-agenda:${[...sessionIds].sort().join("|")}`,
      sessionId: await currentSessionId(), totalUnits: sessionIds.length, unitLabel: "posts"
    });
    return NextResponse.json({ operation }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    await requireSafeOrigin();
    const input = SummitAgendaSessionUpdateSchema.parse(await request.json());
    return NextResponse.json({ agenda: updateSummitAgendaSession(input) });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    await requireSafeOrigin();
    const input = z.object({ sessionId: z.string().min(1).max(240), action: z.literal("reset") }).parse(await request.json());
    return NextResponse.json({ agenda: resetSummitAgendaSession(input.sessionId) });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    await requireSafeOrigin();
    const batchId = z.string().uuid().parse(new URL(request.url).searchParams.get("batch"));
    deleteSummitAgendaBatch(batchId);
    return NextResponse.json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}
