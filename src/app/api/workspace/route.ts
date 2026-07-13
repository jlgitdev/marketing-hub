import { NextResponse } from "next/server";
import { getWorkspaceState } from "@/server/db/repository";
import { connectionStatus } from "@/server/security/key-store";
import { currentSessionId, errorResponse } from "@/server/security/request";
import { ensureDemoSeed } from "@/server/services/demo-seed";
import { ensureProjectContextImported } from "@/server/services/context-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    ensureDemoSeed();
    ensureProjectContextImported();
    const sessionId = await currentSessionId();
    return NextResponse.json(getWorkspaceState(connectionStatus(sessionId)));
  } catch (error) {
    return errorResponse(error, 500);
  }
}
