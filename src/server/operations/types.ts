import type { AiOperationStep } from "@/lib/types";

export class OperationCanceledError extends Error {
  constructor() {
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
