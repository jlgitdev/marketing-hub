import type { AiOperation, AiOperationKind, AiOperationStatus, AiOperationStep, Platform } from "@/lib/types";
import { redactSecrets } from "@/server/security/validation";
import { resolveApiKey } from "@/server/security/key-store";
import { isDemoMode } from "@/server/config";
import { runResearch, ResearchInputSchema } from "@/server/services/research-service";
import { generateOutreach, OutreachInputSchema, regenerateOutreach } from "@/server/services/outreach-service";
import { ContentInputSchema, generateContentCampaign, regeneratePlatforms } from "@/server/services/content-service";
import { generateCampaignGraphic, type CampaignGraphicInput } from "@/server/storage/assets";
import { createSpeakerSpotlights, retrySpeakerSpotlight, SpeakerSpotlightInputSchema } from "@/server/services/speaker-spotlight-service";
import { OperationCanceledError, pendingSteps, type OperationReporter } from "./types";
import { createAiOperation, dismissAiOperationRecord, findActiveOperation, getAiOperation, listAiOperations, publicOperation, updateAiOperation, updateAiOperationInput } from "./repository";

interface QueueItem { operationId: string; sessionId: string | null; }
interface QueueState { queue: QueueItem[]; activeId: string | null; controller: AbortController | null; scheduled: boolean; }

const ACTIVE_OPERATION_STATUSES = new Set<AiOperationStatus>(["queued", "running", "cancel_requested"]);

const globalOperations = globalThis as typeof globalThis & { __marketingHubOperationQueue?: QueueState };
const queueState = globalOperations.__marketingHubOperationQueue ?? { queue: [], activeId: null, controller: null, scheduled: false };
globalOperations.__marketingHubOperationQueue = queueState;

const definitions: Record<AiOperationKind, Array<[string, string]>> = {
  research: [["preparing", "Prepare request"], ["researching", "Research public sources"], ["verifying", "Verify evidence"], ["deduplicating", "Consolidate results"], ["saving", "Save opportunities"]],
  outreach_create: [["loading", "Load selected facts"], ["drafting", "Draft outreach"], ["checking", "Check merge fields"], ["saving", "Save campaign"]],
  outreach_regenerate: [["loading", "Load saved campaign"], ["drafting", "Regenerate drafts"], ["checking", "Check messages"], ["saving", "Save drafts"]],
  content_create: [["selecting", "Select campaign context"], ["drafting", "Draft platform copy"], ["checking", "Check platform constraints"], ["saving", "Save campaign"]],
  content_regenerate: [["loading", "Load saved campaign"], ["drafting", "Regenerate platforms"], ["checking", "Check each draft"], ["saving", "Save updated drafts"]],
  content_image: [["validating", "Validate composition"], ["background", "Create background"], ["resizing", "Fit platform canvas"], ["composing", "Render exact copy"], ["saving", "Save PNG"]],
  spotlight_batch: [["preparing", "Verify campaign references"], ["processing", "Build speaker packages"], ["finalizing", "Finalize batch"]],
  spotlight_retry: [["preparing", "Load verified package"], ["processing", "Generate saved package image"], ["finalizing", "Finalize package"]]
};

export function listPublicOperations(limit = 20) {
  return listAiOperations(limit).map(publicOperation);
}

export function startAiOperation(input: {
  kind: AiOperationKind;
  label: string;
  operationInput: unknown;
  originPath: string;
  targetKey: string;
  sessionId: string | null;
  totalUnits?: number | null;
  unitLabel?: string | null;
}) {
  const duplicate = findActiveOperation(input.targetKey);
  if (duplicate) throw new Error(`“${duplicate.label}” is already ${duplicate.status === "queued" ? "queued" : "running"}.`);
  const sanitizedInput = sanitizeOperationInput(input.operationInput);
  const operation = createAiOperation({
    kind: input.kind, label: input.label, steps: pendingSteps(definitions[input.kind]), originPath: input.originPath,
    targetKey: input.targetKey, operationInput: sanitizedInput, completedUnits: input.totalUnits ? 0 : null,
    totalUnits: input.totalUnits ?? null, unitLabel: input.unitLabel ?? null
  });
  queueState.queue.push({ operationId: operation.id, sessionId: input.sessionId });
  scheduleDrain();
  return publicOperation(operation);
}

export function sanitizeOperationInput(value: unknown): unknown {
  const serialized = JSON.stringify(value, (key, candidate) => {
    if (/^(api_?key|authorization|session_?id|secret|provider_?response|raw_?response|document_?body|body)$/i.test(key)) return undefined;
    return typeof candidate === "string" ? redactSecrets(candidate) : candidate;
  });
  return serialized === undefined ? null : JSON.parse(serialized);
}

export function cancelAiOperation(id: string) {
  const operation = getAiOperation(id);
  if (!operation) throw new Error("AI operation not found.");
  if (operation.status === "queued") {
    queueState.queue = queueState.queue.filter((item) => item.operationId !== id);
    const now = new Date().toISOString();
    return publicOperation(updateAiOperation(id, { status: "canceled", error: "Canceled before the operation started.", retryable: true, completedAt: now, steps: cancelSteps(operation.steps) }));
  }
  if (operation.status === "running" || operation.status === "cancel_requested") {
    const next = updateAiOperation(id, { status: "cancel_requested", error: "Cancel requested. Marketing Hub will stop before the next stage.", retryable: true });
    if (queueState.activeId === id) queueState.controller?.abort();
    return publicOperation(next);
  }
  return publicOperation(operation);
}

export function dismissAiOperation(id: string) {
  return publicOperation(dismissAiOperationRecord(id));
}

export function retryAiOperation(id: string, sessionId: string | null) {
  const operation = getAiOperation(id);
  if (!operation) throw new Error("AI operation not found.");
  if (!["failed", "partially_completed", "canceled", "interrupted"].includes(operation.status)) throw new Error("Only failed, partial, canceled, or interrupted operations can be retried.");
  return startAiOperation({
    kind: operation.kind, label: `Retry · ${operation.label}`, operationInput: operation.input,
    originPath: operation.originPath, targetKey: operation.targetKey, sessionId,
    totalUnits: operation.totalUnits, unitLabel: operation.unitLabel
  });
}

function scheduleDrain() {
  if (queueState.scheduled || queueState.activeId) return;
  queueState.scheduled = true;
  setTimeout(() => {
    queueState.scheduled = false;
    void drainQueue().catch(recoverUnexpectedQueueFailure);
  }, 0);
}

function recoverUnexpectedQueueFailure(error: unknown) {
  const operationId = queueState.activeId;
  queueState.activeId = null;
  queueState.controller = null;
  if (operationId) {
    try {
      const operation = getAiOperation(operationId);
      if (operation && ACTIVE_OPERATION_STATUSES.has(operation.status)) {
        const completedAt = new Date().toISOString();
        updateAiOperation(operationId, {
          status: "failed",
          steps: failSteps(operation.steps),
          error: redactSecrets(error instanceof Error ? error.message : "The background operation stopped unexpectedly."),
          retryable: true,
          completedAt
        });
      }
    } catch (recoveryError) {
      console.error("Could not persist an unexpected AI queue failure.", recoveryError);
    }
  }
  console.error("Unexpected AI queue failure.", error);
  scheduleDrain();
}

async function drainQueue() {
  if (queueState.activeId) return;
  const item = queueState.queue.shift();
  if (!item) return;
  const operation = getAiOperation(item.operationId);
  if (!operation || operation.status !== "queued") { scheduleDrain(); return; }
  queueState.activeId = operation.id;
  queueState.controller = new AbortController();
  const startedAt = new Date().toISOString();
  updateAiOperation(operation.id, { status: "running", startedAt, error: null, retryable: false, steps: activateFirst(operation.steps) });
  try {
    const delay = demoDelayMs();
    if (delay) await abortableDelay(delay, queueState.controller.signal);
    const key = isDemoMode() ? null : resolveApiKey(item.sessionId)?.key || null;
    const reporter = reporterFor(operation.id, queueState.controller.signal);
    const outcome = await executeOperation(operation.kind, operation.input, key, reporter);
    reporter.checkpoint();
    const completedAt = new Date().toISOString();
    const terminalStatus: AiOperationStatus = outcome.failed ? "failed" : outcome.partial ? "partially_completed" : "completed";
    updateAiOperation(operation.id, {
      status: terminalStatus, steps: outcome.failed ? failLastStep(getAiOperation(operation.id)?.steps || operation.steps) : completeSteps(getAiOperation(operation.id)?.steps || operation.steps),
      resultEntityType: outcome.entityType, resultEntityId: outcome.entityId, resultHref: outcome.href,
      error: outcome.error || null, retryable: Boolean(outcome.partial || outcome.failed), completedAt,
      ...(outcome.completedUnits !== undefined ? { completedUnits: outcome.completedUnits } : {})
    });
    if (outcome.retryInput) updateAiOperationInput(operation.id, outcome.retryInput);
  } catch (error) {
    const current = getAiOperation(operation.id) || operation;
    const canceled = error instanceof OperationCanceledError || queueState.controller.signal.aborted || (error instanceof Error && /cancel|abort/i.test(error.message));
    const completedAt = new Date().toISOString();
    updateAiOperation(operation.id, {
      status: canceled ? "canceled" : "failed",
      steps: canceled ? cancelSteps(current.steps) : failSteps(current.steps),
      error: canceled ? "The operation was canceled. Completed sub-results were preserved." : redactSecrets(error instanceof Error ? error.message : "The operation failed."),
      retryable: true,
      completedAt
    });
  } finally {
    queueState.activeId = null;
    queueState.controller = null;
    scheduleDrain();
  }
}

function reporterFor(operationId: string, signal: AbortSignal): OperationReporter {
  return {
    signal,
    stage(stepId, detail = null) {
      const operation = getAiOperation(operationId);
      if (!operation) throw new OperationCanceledError();
      if (signal.aborted || operation.status === "cancel_requested") throw new OperationCanceledError();
      updateAiOperation(operationId, { steps: activateStep(operation.steps, stepId, detail) });
    },
    progress(completed, total, unitLabel = null, detail = null) {
      const operation = getAiOperation(operationId);
      if (!operation) throw new OperationCanceledError();
      const active = operation.steps.find((step) => step.state === "active");
      const steps = detail && active ? operation.steps.map((step) => step.id === active.id ? { ...step, detail } : step) : operation.steps;
      updateAiOperation(operationId, { completedUnits: completed, totalUnits: total, unitLabel, steps });
    },
    checkpoint() {
      const operation = getAiOperation(operationId);
      if (signal.aborted || operation?.status === "cancel_requested") throw new OperationCanceledError();
    }
  };
}

async function executeOperation(kind: AiOperationKind, input: unknown, apiKey: string | null, reporter: OperationReporter): Promise<{
  entityType: AiOperation["resultEntityType"];
  entityId: string | null;
  href: string | null;
  partial?: boolean;
  failed?: boolean;
  error?: string | null;
  completedUnits?: number;
  retryInput?: unknown;
}> {
  switch (kind) {
    case "research": {
      const result = await runResearch(ResearchInputSchema.parse(input), apiKey, reporter.signal, reporter);
      return { entityType: "research", entityId: result.run.id, href: `/leads?run=${result.run.id}` };
    }
    case "outreach_create": {
      const campaign = await generateOutreach(OutreachInputSchema.parse(input), apiKey, reporter.signal, reporter);
      return { entityType: "outreach", entityId: campaign.id, href: `/leads?outreach=${campaign.id}` };
    }
    case "outreach_regenerate": {
      const parsed = input as { campaignId: string; recipientId: string | null };
      const campaign = await regenerateOutreach(parsed.campaignId, parsed.recipientId, apiKey, reporter.signal, reporter);
      return { entityType: "outreach", entityId: campaign.id, href: `/leads?outreach=${campaign.id}` };
    }
    case "content_create": {
      const campaign = await generateContentCampaign(ContentInputSchema.parse(input), apiKey, reporter.signal, reporter);
      return { entityType: "content", entityId: campaign.id, href: `/content?campaign=${campaign.id}` };
    }
    case "content_regenerate": {
      const parsed = input as { campaignId: string; platforms: Platform[] };
      const result = await regeneratePlatforms(parsed.campaignId, parsed.platforms, apiKey, reporter.signal, reporter);
      const partial = result.failures.length > 0;
      const failedPlatforms = result.failures.map((failure) => failure.platform);
      return {
        entityType: "content", entityId: result.campaignId, href: `/content?campaign=${result.campaignId}`,
        partial, completedUnits: result.posts.length,
        error: partial ? `${result.posts.length} of ${parsed.platforms.length} platforms updated. ${result.failures.map((failure) => `${failure.platform}: ${failure.error}`).join(" ")}` : null,
        retryInput: partial ? { ...parsed, platforms: failedPlatforms } : undefined
      };
    }
    case "content_image": {
      const asset = await generateCampaignGraphic({ ...(input as Omit<CampaignGraphicInput, "apiKey">), apiKey }, reporter.signal, reporter);
      return { entityType: "asset", entityId: asset.id, href: `/content?campaign=${asset.campaignId}` };
    }
    case "spotlight_batch": {
      reporter.stage("preparing", "Checking the local speaker source bundle and supplied design references.");
      const batch = await createSpeakerSpotlights(SpeakerSpotlightInputSchema.parse(input), apiKey, reporter);
      reporter.stage("finalizing", "Writing the batch manifest and grouping completed speaker packages.");
      return {
        entityType: "spotlight", entityId: batch.id, href: `/speaker-spotlight?batch=${batch.id}`,
        failed: batch.status === "failed", partial: batch.status === "partially_completed", completedUnits: batch.results.filter((result) => result.status === "completed").length,
        error: batch.status === "completed" ? null : batch.error || batch.warnings.join(" ") || "Some speaker packages need attention."
      };
    }
    case "spotlight_retry": {
      const parsed = input as { resultId: string };
      reporter.stage("preparing", "Loading the preserved profile, headshot, prompt, and partial package.");
      const batch = await retrySpeakerSpotlight(parsed.resultId, apiKey, reporter);
      reporter.stage("finalizing", "Updating the saved batch and retry metadata.");
      const result = batch.results.find((item) => item.id === parsed.resultId);
      return {
        entityType: "spotlight", entityId: batch.id, href: `/speaker-spotlight?batch=${batch.id}`,
        partial: result?.status !== "completed", completedUnits: result?.status === "completed" ? 1 : 0,
        error: result?.status === "completed" ? null : result?.error || "The package still needs attention."
      };
    }
  }
}

function activateFirst(steps: AiOperationStep[]) {
  return steps.map((step, index) => ({ ...step, state: index === 0 ? "active" as const : "pending" as const }));
}

function activateStep(steps: AiOperationStep[], id: string, detail: string | null) {
  const index = steps.findIndex((step) => step.id === id);
  if (index < 0) return steps;
  return steps.map((step, stepIndex): AiOperationStep => ({
    ...step,
    state: stepIndex < index ? "completed" : stepIndex === index ? "active" : "pending",
    detail: stepIndex === index ? detail : step.detail
  }));
}

function completeSteps(steps: AiOperationStep[]) {
  return steps.map((step): AiOperationStep => ({ ...step, state: step.state === "skipped" ? "skipped" : "completed" }));
}

function failSteps(steps: AiOperationStep[]) {
  const activeIndex = steps.findIndex((step) => step.state === "active");
  return steps.map((step, index): AiOperationStep => activeIndex === index ? { ...step, state: "failed" } : step);
}

function failLastStep(steps: AiOperationStep[]) {
  return steps.map((step, index): AiOperationStep => ({ ...step, state: index === steps.length - 1 ? "failed" : "completed" }));
}

function cancelSteps(steps: AiOperationStep[]) {
  return steps.map((step): AiOperationStep => step.state === "active" || step.state === "pending" ? { ...step, state: "skipped" } : step);
}

function demoDelayMs() {
  if (!isDemoMode()) return 0;
  const parsed = Number(process.env.MARKETING_HUB_DEMO_DELAY_MS || 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 10_000)) : 0;
}

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new OperationCanceledError()); }, { once: true });
  });
}
