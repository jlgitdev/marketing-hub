import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSessionId, errorResponse, requireSafeOrigin } from "@/server/security/request";
import { deleteSpeakerSpotlightBatch, getSpeakerSpotlightBatch, listSpeakerSpotlightBatchSummaries } from "@/server/db/repository";
import { SpeakerSpotlightInputSchema, SpeakerSpotlightRetrySchema, speakerSpotlightDefaults } from "@/server/services/speaker-spotlight-service";
import { startAiOperation } from "@/server/operations/manager";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function GET(request: Request) {
  const summaries = listSpeakerSpotlightBatchSummaries();
  const requested = z.string().uuid().safeParse(new URL(request.url).searchParams.get("batch"));
  const selectedId = requested.success && summaries.some((batch) => batch.id === requested.data) ? requested.data : summaries[0]?.id;
  return NextResponse.json({ defaults: speakerSpotlightDefaults(), batches: summaries, batch: selectedId ? getSpeakerSpotlightBatch(selectedId) : null });
}

export async function POST(request: Request) {
  try {
    await requireSafeOrigin();
    const input = SpeakerSpotlightInputSchema.parse(await request.json());
    const names = Array.from(new Map(input.speakerNames.map((name) => name.trim()).filter(Boolean).map((name) => [name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ""), name])).values());
    const operation = startAiOperation({ kind: "spotlight_batch", label: names.length === 1 ? `Speaker Spotlight · ${names[0]}` : `Speaker Spotlights · ${names.length} speakers`, operationInput: input, originPath: "/speaker-spotlight", targetKey: `spotlight:batch:${input.templateId || "selected"}:${names.map((name) => name.toLowerCase()).sort().join("|")}`, sessionId: await currentSessionId(), totalUnits: names.length, unitLabel: "speakers" });
    return NextResponse.json({ operation }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    await requireSafeOrigin();
    const input = SpeakerSpotlightRetrySchema.parse(await request.json());
    const operation = startAiOperation({ kind: "spotlight_retry", label: "Retry Speaker Spotlight", operationInput: input, originPath: "/speaker-spotlight", targetKey: `spotlight:retry:${input.resultId}`, sessionId: await currentSessionId(), totalUnits: 1, unitLabel: "speaker" });
    return NextResponse.json({ operation }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    await requireSafeOrigin();
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    deleteSpeakerSpotlightBatch(id);
    return NextResponse.json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}
