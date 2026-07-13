import { NextResponse } from "next/server";
import { z } from "zod";
import { validateOpenAIKey, ProviderFailure } from "@/server/ai/openai-provider";
import { clearKeySession, connectionStatus, createValidatedKeySession } from "@/server/security/key-store";
import { currentSessionId, errorResponse, KEY_COOKIE, requireSafeOrigin } from "@/server/security/request";
import { KEY_SESSION_TTL_MS } from "@/lib/config";
import { isDemoMode } from "@/server/config";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(connectionStatus(await currentSessionId()));
}

export async function POST(request: Request) {
  try {
    await requireSafeOrigin();
    if (isDemoMode()) return NextResponse.json(connectionStatus(null));
    const { apiKey } = z.object({ apiKey: z.string().min(12).max(300) }).parse(await request.json());
    const session = await createValidatedKeySession(apiKey, validateOpenAIKey);
    const response = NextResponse.json({ connected: true, source: "session", suffix: session.suffix, state: "connected", message: "Connection tested. The key is held only in backend process memory." });
    response.cookies.set(KEY_COOKIE, session.id, { httpOnly: true, sameSite: "strict", secure: new URL(request.url).protocol === "https:", maxAge: Math.floor(KEY_SESSION_TTL_MS / 1000), path: "/" });
    return response;
  } catch (error) {
    const status = error instanceof ProviderFailure && error.code === "invalid_key" ? 401 : error instanceof ProviderFailure && error.code === "rate_limited" ? 429 : 400;
    return errorResponse(error, status);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireSafeOrigin();
    clearKeySession(await currentSessionId());
    const response = NextResponse.json({ connected: false, source: "none", suffix: null, state: "disconnected", message: "Temporary key session cleared." });
    response.cookies.set(KEY_COOKIE, "", { httpOnly: true, sameSite: "strict", maxAge: 0, path: "/", secure: new URL(request.url).protocol === "https:" });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
