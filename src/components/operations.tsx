"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Check, ChevronRight, Circle, Clock3, LoaderCircle, RotateCcw, Square, TriangleAlert, X } from "lucide-react";
import type { AiOperation, AiOperationKind } from "@/lib/types";
import { apiRequest, useWorkspace } from "./workspace";

const ACTIVE_STATUSES = new Set(["queued", "running", "cancel_requested"]);
const TERMINAL_STATUSES = new Set(["completed", "partially_completed", "failed", "canceled", "interrupted"]);

interface OperationsContextValue {
  operations: AiOperation[];
  loading: boolean;
  connectionError: string | null;
  startOperation: (url: string, init: RequestInit) => Promise<AiOperation>;
  cancelOperation: (id: string) => Promise<void>;
  dismissOperation: (id: string) => Promise<void>;
  retryOperation: (id: string) => Promise<AiOperation>;
  refreshOperations: () => Promise<void>;
  findOperation: (matcher: { id?: string | null; kind?: AiOperationKind; targetPrefix?: string; originPath?: string }) => AiOperation | null;
}

const OperationsContext = createContext<OperationsContextValue | null>(null);

export function OperationsProvider({ children }: { children: React.ReactNode }) {
  const { refresh: refreshWorkspace } = useWorkspace();
  const [operations, setOperations] = useState<AiOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [toast, setToast] = useState<AiOperation | null>(null);
  const priorRef = useRef<Map<string, AiOperation>>(new Map());
  const initializedRef = useRef(false);

  const refreshOperations = useCallback(async () => {
    try {
      const response = await apiRequest<{ operations: AiOperation[] }>("/api/operations?limit=20", { cache: "no-store" });
      setConnectionError(null);
      const previous = priorRef.current;
      let terminalTransition = false;
      if (initializedRef.current) {
        for (const operation of response.operations) {
          const prior = previous.get(operation.id);
          if (prior && ACTIVE_STATUSES.has(prior.status) && TERMINAL_STATUSES.has(operation.status)) {
            setToast(operation);
            terminalTransition = true;
          }
        }
      }
      priorRef.current = new Map(response.operations.map((operation) => [operation.id, operation]));
      initializedRef.current = true;
      setOperations(response.operations);
      if (terminalTransition || response.operations.some((operation) => ACTIVE_STATUSES.has(operation.status) && operation.kind.startsWith("spotlight"))) await refreshWorkspace();
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Could not reach the local Marketing Hub server.");
    } finally { setLoading(false); }
  }, [refreshWorkspace]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshOperations(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshOperations]);
  const hasActive = operations.some((operation) => ACTIVE_STATUSES.has(operation.status));
  useEffect(() => {
    const timer = window.setInterval(() => void refreshOperations(), hasActive ? 1000 : 10_000);
    const onFocus = () => void refreshOperations();
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [hasActive, refreshOperations]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const startOperation = useCallback(async (url: string, init: RequestInit) => {
    const response = await apiRequest<{ operation: AiOperation }>(url, init);
    setOperations((current) => [response.operation, ...current.filter((item) => item.id !== response.operation.id)]);
    priorRef.current.set(response.operation.id, response.operation);
    return response.operation;
  }, []);

  const cancelOperation = useCallback(async (id: string) => {
    const response = await apiRequest<{ operation: AiOperation }>(`/api/operations?id=${id}`, { method: "DELETE" });
    setOperations((current) => current.map((item) => item.id === id ? response.operation : item));
  }, []);

  const dismissOperation = useCallback(async (id: string) => {
    await apiRequest<{ operation: AiOperation; dismissed: true }>("/api/operations", { method: "PATCH", body: JSON.stringify({ id }) });
    setOperations((current) => current.filter((item) => item.id !== id));
    priorRef.current.delete(id);
  }, []);

  const retryOperation = useCallback(async (id: string) => {
    const response = await apiRequest<{ operation: AiOperation }>("/api/operations/retry", { method: "POST", body: JSON.stringify({ id }) });
    setOperations((current) => [response.operation, ...current]);
    priorRef.current.set(response.operation.id, response.operation);
    return response.operation;
  }, []);

  const findOperation = useCallback((matcher: { id?: string | null; kind?: AiOperationKind; targetPrefix?: string; originPath?: string }) => {
    if (matcher.id) return operations.find((operation) => operation.id === matcher.id) || null;
    return operations.find((operation) =>
      (!matcher.kind || operation.kind === matcher.kind) &&
      (!matcher.targetPrefix || operation.targetKey.startsWith(matcher.targetPrefix)) &&
      (!matcher.originPath || operation.originPath === matcher.originPath) &&
      ACTIVE_STATUSES.has(operation.status)
    ) || null;
  }, [operations]);

  const value = useMemo(() => ({ operations, loading, connectionError, startOperation, cancelOperation, dismissOperation, retryOperation, refreshOperations, findOperation }), [operations, loading, connectionError, startOperation, cancelOperation, dismissOperation, retryOperation, refreshOperations, findOperation]);
  return <OperationsContext.Provider value={value}>{children}<ActivityDock/>{toast && <CompletionToast operation={toast} onClose={() => setToast(null)}/>}</OperationsContext.Provider>;
}

export function useOperations() {
  const value = useContext(OperationsContext);
  if (!value) throw new Error("useOperations must be used inside OperationsProvider.");
  return value;
}

export function InlineOperation({ operation, compact = false }: { operation: AiOperation | null; compact?: boolean }) {
  const { operations, cancelOperation, dismissOperation, retryOperation } = useOperations();
  const seconds = useOperationSeconds(operation);
  if (!operation) return null;
  const active = ACTIVE_STATUSES.has(operation.status);
  const activeStep = operation.steps.find((step) => step.state === "active") || operation.steps.find((step) => step.state === "failed");
  const queued = operations.filter((item) => item.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const queuePosition = operation.status === "queued" ? queued.findIndex((item) => item.id === operation.id) + 1 : 0;
  return <section className={`operation-card ${compact ? "compact" : ""} status-${operation.status}`} aria-busy={active} aria-label={`${operation.label} progress`}>
    <div className="operation-signal" aria-hidden="true"><OperationSignalIcon operation={operation}/></div>
    <div className="operation-main">
      <div className="operation-title-row"><div><span className="operation-kicker">{statusLabel(operation.status)}</span><h3>{operation.label}</h3></div><Elapsed operation={operation}/></div>
      <div className="operation-live" role="status" aria-live="polite"><strong>{operation.status === "queued" ? "Waiting for the current AI job" : active ? activeStep?.label || statusLabel(operation.status) : terminalHeadline(operation.status)}</strong>{active && activeStep?.detail ? <span>{activeStep.detail}</span> : !active && <span>{terminalDetail(operation.status)}</span>}</div>
      {active && <div className="operation-rail" aria-hidden="true"><span/></div>}
      {operation.totalUnits !== null && <p className="operation-count"><strong>{operation.completedUnits || 0} of {operation.totalUnits}</strong> {operation.unitLabel || "items"} {active ? "processed" : operation.status === "completed" ? "complete" : "succeeded"}</p>}
      {!compact && <ol className="operation-steps">{operation.steps.map((step) => <li className={step.state} key={step.id}><StepIcon state={step.state}/><span>{step.label}</span></li>)}</ol>}
      {active && <p className="operation-away">You can move to another screen—this work will keep running locally.{queuePosition ? ` Queue position ${queuePosition}.` : ""}</p>}
      {active && seconds >= 45 && <p className="operation-reassurance">{seconds >= 90 ? "This is taking longer than usual. The current provider response is still active; you can safely keep working elsewhere." : "Still working—some AI requests need extra time to gather or render a careful result."}</p>}
      {operation.error && !active && <p className="operation-error">{operation.error}</p>}
    </div>
    <div className="operation-actions">
      {active && <button className="button secondary small" onClick={() => void cancelOperation(operation.id)} disabled={operation.status === "cancel_requested"}><Square size={13}/>{operation.status === "cancel_requested" ? "Stopping…" : "Cancel"}</button>}
      {!active && operation.retryable && <button className="button secondary small" onClick={() => void retryOperation(operation.id)}><RotateCcw size={13}/>Retry</button>}
      {operation.resultHref && <Link className="button secondary small" href={operation.resultHref}>View<ChevronRight size={13}/></Link>}
      {!active && <button className="icon-button operation-dismiss" onClick={() => void dismissOperation(operation.id)} aria-label={`Dismiss ${operation.label}`} title="Remove from AI activity"><X size={14}/></button>}
    </div>
  </section>;
}

export function ConnectionTestProgress({ active }: { active: boolean }) {
  return active ? <ActiveConnectionTestProgress/> : null;
}

function ActiveConnectionTestProgress() {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return <div className="connection-test-progress" role="status" aria-live="polite">
    <span className="activity-orb working" aria-hidden="true"><Activity size={15}/></span>
    <div><strong>Sending a small test request</strong><span aria-hidden="true">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span><p>{seconds >= 45 ? "OpenAI is taking a little longer to answer. Keep this screen open while the secure session is established." : "This finishes on this screen so the secure HttpOnly session cookie can be set."}</p></div>
  </div>;
}

function ActivityDock() {
  const { operations, connectionError, refreshOperations } = useOperations();
  const [open, setOpen] = useState(false);
  const active = operations.find((operation) => operation.status === "running" || operation.status === "cancel_requested") || operations.find((operation) => operation.status === "queued");
  const queued = operations.filter((operation) => operation.status === "queued").length;
  if (!operations.length && !connectionError) return null;
  const activeStep = active?.steps.find((step) => step.state === "active");
  return <aside className={`activity-dock ${open ? "open" : ""}`} aria-label="AI activity">
    <button className="activity-trigger" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <span className={connectionError ? "activity-orb" : active ? "activity-orb working" : "activity-orb"}>{connectionError ? <TriangleAlert size={16}/> : <Activity size={16}/>}</span>
      <span><strong>{connectionError ? "Local server unavailable" : active ? activeStep?.label || statusLabel(active.status) : "AI activity"}</strong><small>{connectionError ? "Retrying automatically" : active ? <><Elapsed operation={active} short/> {queued > 0 && `· ${queued} queued`}</> : "Recent work and results"}</small></span>
      <ChevronRight className="activity-chevron" size={16}/>
    </button>
    {open && <div className="activity-drawer"><div className="activity-drawer-heading"><div><h2>AI activity</h2><p className="muted">{connectionError ? "Connection interrupted" : active ? "Work in progress" : "Recent work"}</p></div><button className="icon-button" onClick={() => setOpen(false)} aria-label="Close AI activity"><X size={16}/></button></div>{connectionError && <div className="warnings"><TriangleAlert size={15}/><span>{connectionError}</span><button className="button secondary small" onClick={() => void refreshOperations()}>Retry now</button></div>}<div className="activity-list">{operations.slice(0, 8).map((operation) => <InlineOperation key={operation.id} operation={operation} compact/>)}</div></div>}
  </aside>;
}

function CompletionToast({ operation, onClose }: { operation: AiOperation; onClose: () => void }) {
  const success = operation.status === "completed";
  return <div className={`operation-toast ${success ? "success" : "warning"}`} role="status"><span>{success ? <Check/> : <TriangleAlert/>}</span><div><strong>{success ? "Finished" : operation.status === "partially_completed" ? "Finished with notes" : "Needs attention"}</strong><p>{operation.label}</p></div>{operation.resultHref && <Link href={operation.resultHref} onClick={onClose}>View</Link>}<button className="icon-button" onClick={onClose} aria-label="Dismiss notification"><X size={14}/></button></div>;
}

function Elapsed({ operation, short = false }: { operation: AiOperation; short?: boolean }) {
  const seconds = useOperationSeconds(operation);
  const text = operation.completedAt && seconds === 0 ? "<1s" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  if (short) return <span aria-hidden="true">{text}</span>;
  return <span className="operation-elapsed" aria-hidden="true"><Clock3 size={13}/>{text}</span>;
}

function useOperationSeconds(operation: AiOperation | null) {
  const [now, setNow] = useState(() => Date.now());
  const operationId = operation?.id;
  const operationStatus = operation?.status;
  useEffect(() => {
    if (!operationId || !operationStatus || !ACTIVE_STATUSES.has(operationStatus)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [operationId, operationStatus]);
  if (!operation) return 0;
  const start = new Date(operation.startedAt || operation.createdAt).getTime();
  const end = operation.completedAt ? new Date(operation.completedAt).getTime() : now;
  return Math.max(0, Math.floor((end - start) / 1000));
}

function StepIcon({ state }: { state: AiOperation["steps"][number]["state"] }) {
  if (state === "completed") return <Check size={13}/>;
  if (state === "active") return <LoaderCircle className="spin" size={13}/>;
  if (state === "failed") return <TriangleAlert size={13}/>;
  return <Circle size={11}/>;
}

function OperationSignalIcon({ operation }: { operation: AiOperation }) {
  if (ACTIVE_STATUSES.has(operation.status)) return <LoaderCircle className="spin" size={18}/>;
  if (operation.status === "completed") return <Check size={18}/>;
  if (operation.status === "canceled") return <Square size={16}/>;
  return <TriangleAlert size={18}/>;
}

function terminalHeadline(status: AiOperation["status"]) {
  return ({ completed: "Finished and saved", partially_completed: "Finished with incomplete results", failed: "Stopped with an issue", canceled: "Canceled", interrupted: "Interrupted by a restart" } as Partial<Record<AiOperation["status"], string>>)[status] || statusLabel(status);
}

function terminalDetail(status: AiOperation["status"]) {
  if (status === "completed") return "This operation is no longer running. Open the saved result whenever you are ready.";
  if (status === "partially_completed") return "This operation is no longer running. Some requested items succeeded and others need attention.";
  if (status === "failed") return "This operation is no longer running. Open the result for the exact failure and available recovery options.";
  if (status === "interrupted") return "The local process stopped. Reconnect OpenAI and retry when ready.";
  return "No more background work will run for this operation.";
}

function statusLabel(status: AiOperation["status"]) {
  return ({ queued: "Queued", running: "Working", cancel_requested: "Stopping", completed: "Completed", partially_completed: "Partially completed", failed: "Needs attention", canceled: "Canceled", interrupted: "Interrupted" } as const)[status];
}
