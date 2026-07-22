"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { WorkspaceState } from "@/lib/types";

interface WorkspaceContextValue {
  state: WorkspaceState | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch("/api/workspace", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load the local workspace.");
      setState(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the local workspace.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  const value = useMemo(() => ({ state, error, loading, refresh }), [state, error, loading, refresh]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider.");
  return value;
}

export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (error) {
    if (error instanceof TypeError) throw new Error("Could not reach the local Marketing Hub server. Make sure npm run dev is still running, then retry.", { cause: error });
    throw error;
  }
  const type = response.headers.get("content-type") || "";
  const body = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(typeof body === "object" && body?.error ? body.error : "The local request could not be completed.");
  return body as T;
}

export function PageState({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => void }) {
  if (loading) return <div className="page"><div className="skeleton hero-skeleton"/><div className="grid three"><div className="skeleton card-skeleton"/><div className="skeleton card-skeleton"/><div className="skeleton card-skeleton"/></div></div>;
  if (error) return <div className="page"><div className="empty-state danger"><h1>Marketing Hub could not open</h1><p>{error}</p><button className="button" onClick={retry}>Retry</button></div></div>;
  return null;
}

export function ConnectionBadge({ state }: { state: WorkspaceState }) {
  return <span className={`badge ${state.connection.connected ? "success" : "warning"}`}><span className="badge-dot"/>{state.demoMode ? "Demo mode" : state.connection.connected ? state.connection.source === "environment" ? "OpenAI via environment" : `OpenAI ••••${state.connection.suffix}` : "OpenAI disconnected"}</span>;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function cleanDisplayText(value: string | null | undefined) {
  return (value || "").replace(/^\s*>+\s*/gm, "").replace(/[ \t]{2,}/g, " ").trim();
}

export function cleanDocumentTitle(value: string) {
  const cleaned = value.replace(/\s*\(\d+\)\s*$/, "").replaceAll("_", " ").replace(/\s+/g, " ").trim();
  return cleaned ? `${cleaned[0].toUpperCase()}${cleaned.slice(1)}` : value;
}

export function cleanCampaignName(value: string) {
  const cleaned = cleanDisplayText(value);
  return cleaned.length >= 88 && !/[.!?…]$/.test(cleaned) ? `${cleaned}…` : cleaned;
}
