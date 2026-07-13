import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { redactSecrets } from "./validation";
import { resolveApiKey } from "./key-store";

export const KEY_COOKIE = "marketing_hub_key_session";

export async function requireSafeOrigin() {
  const incoming = await headers();
  const origin = incoming.get("origin");
  if (!origin) return;
  const url = new URL(origin);
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)) throw new Error("State-changing requests are accepted only from the loopback application origin.");
}

export async function currentSessionId() {
  return (await cookies()).get(KEY_COOKIE)?.value || null;
}

export async function currentApiKey() {
  return resolveApiKey(await currentSessionId())?.key || null;
}

export function errorResponse(error: unknown, status = 400) {
  const message = redactSecrets(error instanceof Error ? error.message : String(error));
  return NextResponse.json({ error: message }, { status });
}
