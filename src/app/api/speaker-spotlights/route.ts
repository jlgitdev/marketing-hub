import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSessionId, errorResponse, requireSafeOrigin } from "@/server/security/request";
import { deleteSpeakerSpotlightBatch, listSpeakerSpotlightBatches } from "@/server/db/repository";
import { approveSpeakerSpotlightImage, SpeakerSpotlightInputSchema, SpeakerSpotlightRetrySchema, SpeakerSpotlightReviewSchema, speakerSpotlightDefaults } from "@/server/services/speaker-spotlight-service";
import { startAiOperation } from "@/server/operations/manager";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function GET() {
  return NextResponse.json({ defaults: speakerSpotlightDefaults(), batches: listSpeakerSpotlightBatches() });
}

export async function POST(request: Request) {
  try {
    await requireSafeOrigin();
    const input = SpeakerSpotlightInputSchema.parse(await request.json());
    const names = Array.from(new Set(input.speakerNames.map((name) => name.trim()).filter(Boolean)));
    const operation = startAiOperation({ kind: "spotlight_batch", label: names.length === 1 ? `Speaker Spotlight · ${names[0]}` : `Speaker Spotlights · ${names.length} speakers`, operationInput: input, originPath: "/speaker-spotlight", targetKey: `spotlight:batch:${names.map((name) => name.toLowerCase()).sort().join("|")}`, sessionId: await currentSessionId(), totalUnits: names.length, unitLabel: "speakers" });
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

export async function PUT(request: Request) {
  try {
    await requireSafeOrigin();
    const input = SpeakerSpotlightReviewSchema.parse(await request.json());
    const batch = await approveSpeakerSpotlightImage(input.resultId);
    return NextResponse.json({ batch });
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
