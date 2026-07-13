import crypto from "node:crypto";
import type { AiOperation, AiOperationKind, AiOperationStatus, AiOperationStep } from "@/lib/types";
import { getDatabase } from "@/server/db/database";

export interface StoredAiOperation extends AiOperation {
  input: unknown;
  dismissedAt: string | null;
}

function parse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function fromRow(row: Record<string, unknown>): StoredAiOperation {
  return {
    id: String(row.id),
    kind: row.kind as AiOperationKind,
    label: String(row.label),
    status: row.status as AiOperationStatus,
    steps: parse(String(row.steps || "[]"), [] as AiOperationStep[]),
    completedUnits: row.completed_units === null || row.completed_units === undefined ? null : Number(row.completed_units),
    totalUnits: row.total_units === null || row.total_units === undefined ? null : Number(row.total_units),
    unitLabel: row.unit_label ? String(row.unit_label) : null,
    resultEntityType: row.result_entity_type ? String(row.result_entity_type) as AiOperation["resultEntityType"] : null,
    resultEntityId: row.result_entity_id ? String(row.result_entity_id) : null,
    resultHref: row.result_href ? String(row.result_href) : null,
    originPath: String(row.origin_path),
    targetKey: String(row.target_key),
    input: parse(String(row.input_json || "{}"), {}),
    dismissedAt: row.dismissed_at ? String(row.dismissed_at) : null,
    error: row.error ? String(row.error) : null,
    retryable: Boolean(row.retryable),
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null
  };
}

export function publicOperation(operation: StoredAiOperation): AiOperation {
  const { input: _input, dismissedAt: _dismissedAt, ...safe } = operation;
  void _input; void _dismissedAt;
  return safe;
}

export function createAiOperation(input: {
  kind: AiOperationKind;
  label: string;
  steps: AiOperationStep[];
  originPath: string;
  targetKey: string;
  operationInput: unknown;
  completedUnits?: number | null;
  totalUnits?: number | null;
  unitLabel?: string | null;
}) {
  const now = new Date().toISOString();
  const operation: StoredAiOperation = {
    id: crypto.randomUUID(), kind: input.kind, label: input.label, status: "queued", steps: input.steps,
    completedUnits: input.completedUnits ?? null, totalUnits: input.totalUnits ?? null, unitLabel: input.unitLabel ?? null,
    resultEntityType: null, resultEntityId: null, resultHref: null, originPath: input.originPath,
    targetKey: input.targetKey, input: input.operationInput, dismissedAt: null, error: null, retryable: false,
    createdAt: now, startedAt: null, updatedAt: now, completedAt: null
  };
  getDatabase().prepare(`INSERT INTO ai_operations(id,kind,label,status,steps,completed_units,total_units,unit_label,result_entity_type,result_entity_id,result_href,origin_path,target_key,input_json,error,retryable,created_at,started_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(operation.id, operation.kind, operation.label, operation.status, JSON.stringify(operation.steps), operation.completedUnits, operation.totalUnits, operation.unitLabel, null, null, null, operation.originPath, operation.targetKey, JSON.stringify(operation.input), null, 0, now, null, now, null);
  return operation;
}

export function listAiOperations(limit = 20) {
  return (getDatabase().prepare("SELECT * FROM ai_operations WHERE dismissed_at IS NULL ORDER BY created_at DESC LIMIT ?").all(Math.max(1, Math.min(limit, 100))) as Array<Record<string, unknown>>).map(fromRow);
}

export function getAiOperation(id: string) {
  const row = getDatabase().prepare("SELECT * FROM ai_operations WHERE id=?").get(id) as Record<string, unknown> | undefined;
  return row ? fromRow(row) : null;
}

export function findActiveOperation(targetKey: string) {
  const row = getDatabase().prepare("SELECT * FROM ai_operations WHERE target_key=? AND status IN ('queued','running','cancel_requested') ORDER BY created_at DESC LIMIT 1").get(targetKey) as Record<string, unknown> | undefined;
  return row ? fromRow(row) : null;
}

export function updateAiOperation(id: string, patch: Partial<Omit<StoredAiOperation, "id" | "kind" | "input" | "createdAt">>) {
  const current = getAiOperation(id);
  if (!current) throw new Error("AI operation not found.");
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  getDatabase().prepare(`UPDATE ai_operations SET label=?,status=?,steps=?,completed_units=?,total_units=?,unit_label=?,result_entity_type=?,result_entity_id=?,result_href=?,origin_path=?,target_key=?,error=?,retryable=?,started_at=?,updated_at=?,completed_at=? WHERE id=?`)
    .run(next.label, next.status, JSON.stringify(next.steps), next.completedUnits, next.totalUnits, next.unitLabel, next.resultEntityType, next.resultEntityId, next.resultHref, next.originPath, next.targetKey, next.error, Number(next.retryable), next.startedAt, next.updatedAt, next.completedAt, id);
  return next;
}

export function updateAiOperationInput(id: string, input: unknown) {
  const current = getAiOperation(id);
  if (!current) throw new Error("AI operation not found.");
  getDatabase().prepare("UPDATE ai_operations SET input_json=?,updated_at=? WHERE id=?").run(JSON.stringify(input), new Date().toISOString(), id);
  return { ...current, input };
}

export function dismissAiOperationRecord(id: string) {
  const current = getAiOperation(id);
  if (!current) throw new Error("AI operation not found.");
  if (["queued", "running", "cancel_requested"].includes(current.status)) throw new Error("Cancel active work before dismissing it.");
  const dismissedAt = new Date().toISOString();
  getDatabase().prepare("UPDATE ai_operations SET dismissed_at=?,updated_at=? WHERE id=?").run(dismissedAt, dismissedAt, id);
  return { ...current, dismissedAt, updatedAt: dismissedAt };
}
