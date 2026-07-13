import crypto from "node:crypto";
import { z } from "zod";
import { DEFAULT_RESULT_COUNT, MAX_RESULT_COUNT, PROMPT_VERSIONS } from "@/lib/config";
import { isDemoMode, MODELS } from "@/server/config";
import type { ResearchRun } from "@/lib/types";
import { DEMO_FAILURE_TRIGGERS, demoResearchBundle } from "@/server/ai/demo-provider";
import { researchWithOpenAI } from "@/server/ai/openai-provider";
import { createResearchRun, saveLeads, updateResearchRun, addActivity } from "@/server/db/repository";
import { assertContextSize, contextConflictWarnings } from "@/server/security/validation";
import { validateAndNormalizeLeads } from "./lead-validation";
import { selectRelevantContext } from "./context-service";
import type { OperationReporter } from "@/server/operations/types";

export const ResearchInputSchema = z.object({
  name: z.string().min(2).max(100),
  objective: z.string().min(10).max(1000),
  region: z.string().min(2).max(120).default("San Francisco Bay Area"),
  count: z.coerce.number().int().min(1).max(MAX_RESULT_COUNT).default(DEFAULT_RESULT_COUNT),
  contextDocumentIds: z.array(z.string().uuid()).default([]),
  contextMode: z.enum(["auto", "manual"]).default("auto"),
  opportunityTypes: z.array(z.string()).default(["organization", "event"]),
  organizationCategories: z.array(z.string()).default(["education", "AI communities", "startup communities"]),
  eventCategories: z.array(z.string()).default(["AI events", "technology events", "education events", "startup events"]),
  targetRoles: z.array(z.string()).default(["partnerships", "community", "events", "marketing", "programs"]),
  audienceRoles: z.array(z.string()).default(["builders", "researchers", "founders", "educators", "community leaders"]),
  positiveKeywords: z.string().max(500).default(""),
  exclusionKeywords: z.string().max(500).default(""),
  dateRange: z.string().max(100).default(""),
  notes: z.string().max(1000).default("")
});

const activeRuns = new Set<string>();

export async function runResearch(input: z.input<typeof ResearchInputSchema>, apiKey: string | null, signal?: AbortSignal, reporter?: OperationReporter) {
  reporter?.stage("preparing", "Validating the request and selecting the most relevant local context.");
  reporter?.checkpoint();
  const parsed = ResearchInputSchema.parse(input);
  const selection = selectRelevantContext({ workflow: "research", query: `${parsed.name} ${parsed.objective} ${parsed.region} ${parsed.opportunityTypes.join(" ")} ${parsed.organizationCategories.join(" ")} ${parsed.eventCategories.join(" ")} ${parsed.notes}`, manualIds: parsed.contextDocumentIds, automatic: parsed.contextMode === "auto" });
  const context = selection.documents;
  assertContextSize(context);
  const duplicateKey = JSON.stringify([parsed.name, parsed.region, selection.documentIds.slice().sort()]);
  if (activeRuns.has(duplicateKey)) throw new Error("An identical research request is already running.");
  activeRuns.add(duplicateKey);
  const now = new Date().toISOString();
  const run: ResearchRun = {
    id: crypto.randomUUID(), name: parsed.name, objective: parsed.objective, region: parsed.region, status: "running",
    requestedCount: parsed.count, resultCount: 0, contextDocumentIds: selection.documentIds,
    settings: { contextMode: parsed.contextMode, contextRationale: selection.rationale, opportunityTypes: parsed.opportunityTypes, organizationCategories: parsed.organizationCategories, eventCategories: parsed.eventCategories, targetRoles: parsed.targetRoles, audienceRoles: parsed.audienceRoles, positiveKeywords: parsed.positiveKeywords, exclusionKeywords: parsed.exclusionKeywords, dateRange: parsed.dateRange, notes: parsed.notes },
    model: isDemoMode() ? "demo-provider-v1" : MODELS.text, promptVersion: PROMPT_VERSIONS.research,
    provider: isDemoMode() ? "demo" : "openai", usage: null, warnings: [], error: null, rawOutput: null, startedAt: now, completedAt: null
  };
  createResearchRun(run);
  try {
    reporter?.stage("researching", "OpenAI is searching public sources and assembling a structured, cited result.");
    reporter?.checkpoint();
    if (isDemoMode() && parsed.objective.includes(DEMO_FAILURE_TRIGGERS.provider)) throw new Error("Deterministic demo provider error: research could not be completed.");
    const providerResult = isDemoMode()
      ? { bundle: demoResearchBundle(), sourceMetadata: new Map<string, Record<string, unknown>>(), rawOutput: JSON.stringify(demoResearchBundle()), usage: null }
      : await researchWithOpenAI(requireKey(apiKey), { ...parsed, context }, signal);
    reporter?.stage("verifying", "Checking URLs, evidence, dates, and public contact claims returned by the model.");
    reporter?.checkpoint();
    const leads = validateAndNormalizeLeads(providerResult.bundle, run.id, providerResult.sourceMetadata).slice(0, parsed.count);
    reporter?.stage("deduplicating", "Consolidating repeated organizations while preserving every supporting source.");
    reporter?.checkpoint();
    reporter?.stage("saving", `Saving ${leads.length} inspectable opportunit${leads.length === 1 ? "y" : "ies"} locally.`);
    reporter?.checkpoint();
    saveLeads(run.id, leads);
    run.status = leads.length ? "completed" : "partially_completed";
    run.resultCount = leads.length;
    run.warnings = Array.from(new Set([...providerResult.bundle.warnings, ...contextConflictWarnings(context)]));
    run.rawOutput = providerResult.rawOutput;
    run.usage = providerResult.usage;
    run.completedAt = new Date().toISOString();
    updateResearchRun(run);
    addActivity("research_completed", run.name, `${leads.length} source-backed opportunities`, run.id);
    return { run, leads };
  } catch (error) {
    run.status = error instanceof Error && /canceled|aborted/i.test(error.message) ? "canceled" : "failed";
    run.error = error instanceof Error ? error.message : "Research failed.";
    run.completedAt = new Date().toISOString();
    updateResearchRun(run);
    throw error;
  } finally {
    activeRuns.delete(duplicateKey);
  }
}

function requireKey(key: string | null) {
  if (!key) throw new Error("Connect an OpenAI API key before starting live research.");
  return key;
}
