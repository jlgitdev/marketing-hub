import { NextResponse } from "next/server";
import { z } from "zod";
import { retryAiOperation } from "@/server/operations/manager";
import { currentSessionId, errorResponse, requireSafeOrigin } from "@/server/security/request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireSafeOrigin();
    const { id } = z.object({ id: z.string().uuid() }).parse(await request.json());
    return NextResponse.json({ operation: retryAiOperation(id, await currentSessionId()) }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}
