import { NextResponse } from "next/server";
import { z } from "zod";
import { resetAllData } from "@/server/db/repository";
import { errorResponse, requireSafeOrigin } from "@/server/security/request";

export async function POST(request: Request) {
  try { await requireSafeOrigin(); z.object({ confirm: z.literal(true) }).parse(await request.json()); resetAllData(); return NextResponse.json({ reset: true }); }
  catch (error) { return errorResponse(error); }
}
