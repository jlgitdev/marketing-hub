import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSessionId, errorResponse, requireSafeOrigin } from "@/server/security/request";
import { startAiOperation } from "@/server/operations/manager";

export const runtime = "nodejs";
export const maxDuration = 210;

const PlatformSchema = z.enum(["general", "x", "linkedin", "instagram"]);
const Schema = z.object({ campaignId: z.string().uuid(), platform: PlatformSchema.optional(), platforms: z.array(PlatformSchema).min(1).optional() }).refine((value) => Boolean(value.platform) !== Boolean(value.platforms), "Provide either platform or platforms.");

export async function POST(request: Request) {
  try { await requireSafeOrigin(); const parsed = Schema.parse(await request.json()); const platforms = Array.from(new Set(parsed.platforms || [parsed.platform!])); const input = { campaignId: parsed.campaignId, platforms }; const operation = startAiOperation({ kind: "content_regenerate", label: platforms.length === 1 ? `Regenerate ${platforms[0] === "x" ? "X" : platforms[0][0].toUpperCase() + platforms[0].slice(1)}` : "Regenerate all platform drafts", operationInput: input, originPath: "/content", targetKey: `content:regenerate:${parsed.campaignId}:${platforms.slice().sort().join(",")}`, sessionId: await currentSessionId(), totalUnits: platforms.length, unitLabel: "platforms" }); return NextResponse.json({ operation }, { status: 202 }); }
  catch (error) { return errorResponse(error); }
}
