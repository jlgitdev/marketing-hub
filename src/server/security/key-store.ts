import crypto from "node:crypto";
import { KEY_SESSION_TTL_MS } from "@/lib/config";
import { isDemoMode } from "@/server/config";
import type { ConnectionStatus } from "@/lib/types";

interface KeySession {
  key: string;
  suffix: string;
  expiresAt: number;
}

const globalStore = globalThis as typeof globalThis & { __marketingHubKeys?: Map<string, KeySession> };
const sessions = globalStore.__marketingHubKeys ?? new Map<string, KeySession>();
globalStore.__marketingHubKeys = sessions;

export function createKeySession(key: string) {
  purgeExpiredSessions();
  const id = crypto.randomBytes(32).toString("base64url");
  const cleaned = key.trim();
  sessions.set(id, {
    key: cleaned,
    suffix: cleaned.slice(-4),
    expiresAt: Date.now() + KEY_SESSION_TTL_MS
  });
  return { id, suffix: cleaned.slice(-4), expiresAt: Date.now() + KEY_SESSION_TTL_MS };
}

export async function createValidatedKeySession(key: string, validator: (candidate: string) => Promise<boolean>) {
  const valid = await validator(key);
  if (!valid) throw new Error("The API key was rejected.");
  return createKeySession(key);
}

export function resolveApiKey(sessionId?: string | null) {
  purgeExpiredSessions();
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session) return { key: session.key, source: "session" as const, suffix: session.suffix };
  }
  const environmentKey = process.env.OPENAI_API_KEY?.trim();
  if (environmentKey) return { key: environmentKey, source: "environment" as const, suffix: environmentKey.slice(-4) };
  return null;
}

export function clearKeySession(sessionId?: string | null) {
  if (!sessionId) return false;
  return sessions.delete(sessionId);
}

export function purgeExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

export function connectionStatus(sessionId?: string | null): ConnectionStatus {
  if (isDemoMode()) {
    return {
      connected: true,
      source: "demo",
      suffix: null,
      state: "connected",
      message: "Deterministic demo provider — no network or API charges."
    };
  }
  const resolved = resolveApiKey(sessionId);
  if (!resolved) {
    return {
      connected: false,
      source: "none",
      suffix: null,
      state: "disconnected",
      message: "Connect a temporary OpenAI API key to use live AI actions."
    };
  }
  return {
    connected: true,
    source: resolved.source,
    suffix: resolved.suffix,
    state: "connected",
    message: resolved.source === "environment" ? "Connected through local environment configuration." : "Temporary key held in backend memory."
  };
}

export function sessionCountForTests() {
  return sessions.size;
}

export function resetKeyStoreForTests() {
  sessions.clear();
}
