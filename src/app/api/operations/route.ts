import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelAiOperation, dismissAiOperation, listPublicOperations } from "@/server/operations/manager";
import { errorResponse, requireSafeOrigin } from "@/server/security/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const limit = z.coerce.number().int().min(1).max(100).default(20).parse(new URL(request.url).searchParams.get("limit") || 20);
    return NextResponse.json({ operations: listPublicOperations(limit) });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    await requireSafeOrigin();
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    return NextResponse.json({ operation: cancelAiOperation(id) });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    await requireSafeOrigin();
    const id = z.string().uuid().parse((await request.json() as { id?: unknown }).id);
    return NextResponse.json({ operation: dismissAiOperation(id), dismissed: true });
  } catch (error) { return errorResponse(error); }
}
