import type { AiOperation, AiOperationStep } from "@/lib/types";

export interface CanceledOperationOutcome {
  resultEntityType: AiOperation["resultEntityType"];
  resultEntityId: string | null;
  resultHref: string | null;
  completedUnits?: number;
  retryable?: boolean;
  retryInput?: unknown;
}

export class OperationCanceledError extends Error {
  constructor(public outcome: CanceledOperationOutcome | null = null) {
    super("The operation was canceled.");
    this.name = "OperationCanceledError";
  }
}

export interface OperationReporter {
  signal: AbortSignal;
  stage: (stepId: string, detail?: string | null) => void;
  progress: (completed: number, total: number, unitLabel?: string | null, detail?: string | null) => void;
  checkpoint: () => void;
}

export function pendingSteps(items: Array<[string, string]>): AiOperationStep[] {
  return items.map(([id, label]) => ({ id, label, state: "pending", detail: null }));
}
