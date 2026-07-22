import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { redactSecrets } from "./validation";
import { resolveApiKey } from "./key-store";

export const KEY_COOKIE = "marketing_hub_key_session";

export async function requireSafeOrigin(request?: Request) {
  const incoming = await headers();
  const origin = incoming.get("origin");
  if (!origin) return;
  const host = incoming.get("host");
  const expectedOrigin = request ? new URL(request.url).origin : null;
  if (!isSafeApplicationOrigin(origin, host, expectedOrigin)) throw new Error("State-changing requests are accepted only from the exact loopback application origin.");
}

export function isSafeApplicationOrigin(origin: string, host: string | null, expectedOrigin: string | null = null) {
  if (!host) return false;
  try {
    const url = new URL(origin);
    const normalizedHost = host.split(",")[0].trim().toLowerCase();
    const loopback = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname.toLowerCase());
    const supportedProtocol = url.protocol === "http:" || url.protocol === "https:";
    const expected = expectedOrigin ? new URL(expectedOrigin) : null;
    const exactRequestOrigin = !expected || expected.host.toLowerCase() !== normalizedHost || url.origin === expected.origin;
    return loopback && supportedProtocol && exactRequestOrigin && url.host.toLowerCase() === normalizedHost;
  } catch {
    return false;
  }
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
