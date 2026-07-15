import crypto from "node:crypto";
import { z } from "zod";
import { DEFAULT_RESULT_COUNT, MAX_RESULT_COUNT, PROMPT_VERSIONS } from "@/lib/config";
import { isDemoMode, MODELS } from "@/server/config";
import type { ResearchRun } from "@/lib/types";
import { DEMO_FAILURE_TRIGGERS, demoResearchBundle } from "@/server/ai/demo-provider";
import { researchBackfillWithOpenAI, researchWithOpenAI } from "@/server/ai/openai-provider";
import { createResearchRun, saveLeads, updateResearchRun, addActivity, listLeads } from "@/server/db/repository";
import { assertContextSize, contextConflictWarnings } from "@/server/security/validation";
import { deduplicateLeads, validateAndNormalizeLeads } from "./lead-validation";
import { prioritizeNovelLeads } from "./lead-qualification";
import { selectRelevantContext } from "./context-service";
import type { OperationReporter } from "@/server/operations/types";

export const ResearchInputSchema = z.object({
  name: z.string().min(2).max(100),
  objective: z.string().min(10).max(1000),
  region: z.string().min(2).max(120).default("San Francisco Bay Area"),
  count: z.coerce.number().int().min(1).max(MAX_RESULT_COUNT).default(DEFAULT_RESULT_COUNT),
  contextDocumentIds: z.array(z.string().uuid()).default([]),
  contextMode: z.enum(["auto", "manual"]).default("auto"),
  opportunityTypes: z.array(z.enum(["organization", "event"])).min(1).default(["organization", "event"]),
  organizationCategories: z.array(z.string()).default(["education", "AI communities", "startup communities"]),
  eventCategories: z.array(z.string()).default(["AI events", "technology events", "education events", "startup events"]),
  targetRoles: z.array(z.string()).default(["partnerships", "community", "events", "marketing", "programs"]),
  audienceRoles: z.array(z.string()).default(["builders", "researchers", "founders", "educators", "community leaders"]),
  positiveKeywords: z.string().max(500).default(""),
  exclusionKeywords: z.string().max(500).default(""),
  dateRange: z.string().max(100).default(""),
  notes: z.string().max(1000).default(""),
  targetSegments: z.array(z.enum(["ai_professionals", "technology_employees", "founders_operators", "researchers_academics", "college_students", "college_prep_education", "educators", "community_leaders", "investors_executives", "general_technology"])).min(1).default(["ai_professionals", "technology_employees", "founders_operators", "researchers_academics", "college_students", "college_prep_education", "educators", "community_leaders", "investors_executives"]),
  salesMotions: z.array(z.enum(["direct_ticket_sales", "group_ticket_sales", "partner_distribution", "employer_learning_budget", "education_distribution", "cross_promotion", "sponsorship"])).min(1).default(["direct_ticket_sales", "group_ticket_sales", "partner_distribution", "employer_learning_budget", "education_distribution", "cross_promotion"]),
  minimumPriorityScore: z.coerce.number().int().min(0).max(100).default(45),
  excludePreviouslyResearched: z.coerce.boolean().default(true)
});

const activeRuns = new Set<string>();

export async function runResearch(input: z.input<typeof ResearchInputSchema>, apiKey: string | null, signal?: AbortSignal, reporter?: OperationReporter) {
  reporter?.stage("preparing", "Validating the request and selecting the most relevant local context.");
  reporter?.checkpoint();
  const parsed = ResearchInputSchema.parse(input);
  const selection = selectRelevantContext({ workflow: "research", query: `${parsed.name} ${parsed.objective} ${parsed.region} ${parsed.opportunityTypes.join(" ")} ${parsed.organizationCategories.join(" ")} ${parsed.eventCategories.join(" ")} ${parsed.targetRoles.join(" ")} ${parsed.audienceRoles.join(" ")} ${parsed.targetSegments.join(" ")} ${parsed.salesMotions.join(" ")} ${parsed.positiveKeywords} ${parsed.exclusionKeywords} ${parsed.dateRange} ${parsed.notes}`, manualIds: parsed.contextDocumentIds, automatic: parsed.contextMode === "auto" });
  const context = selection.documents;
  assertContextSize(context);
  const duplicateKey = JSON.stringify([parsed.name, parsed.region, selection.documentIds.slice().sort()]);
  if (activeRuns.has(duplicateKey)) throw new Error("An identical research request is already running.");
  activeRuns.add(duplicateKey);
  const now = new Date().toISOString();
  const run: ResearchRun = {
    id: crypto.randomUUID(), name: parsed.name, objective: parsed.objective, region: parsed.region, status: "running",
    requestedCount: parsed.count, resultCount: 0, contextDocumentIds: selection.documentIds,
    settings: { contextMode: parsed.contextMode, contextRationale: selection.rationale, opportunityTypes: parsed.opportunityTypes, organizationCategories: parsed.organizationCategories, eventCategories: parsed.eventCategories, targetRoles: parsed.targetRoles, audienceRoles: parsed.audienceRoles, targetSegments: parsed.targetSegments, salesMotions: parsed.salesMotions, minimumPriorityScore: parsed.minimumPriorityScore, excludePreviouslyResearched: parsed.excludePreviouslyResearched, positiveKeywords: parsed.positiveKeywords, exclusionKeywords: parsed.exclusionKeywords, dateRange: parsed.dateRange, notes: parsed.notes },
    model: isDemoMode() ? "demo-provider-v1" : MODELS.text, promptVersion: PROMPT_VERSIONS.research,
    provider: isDemoMode() ? "demo" : "openai", usage: null, warnings: [], error: null, rawOutput: null, startedAt: now, completedAt: null
  };
  createResearchRun(run);
  try {
    reporter?.stage("researching", "OpenAI is searching public sources and assembling a structured, cited result.");
    reporter?.checkpoint();
    if (isDemoMode() && parsed.objective.includes(DEMO_FAILURE_TRIGGERS.provider)) throw new Error("Deterministic demo provider error: research could not be completed.");
    const priorLeads = listLeads();
    const memory = researchMemory(priorLeads);
    const providerRequest = { ...parsed, notes: [parsed.notes, memory].filter(Boolean).join("\n\n"), context };
    const providerResult = isDemoMode()
      ? { bundle: demoResearchBundle(), sourceMetadata: new Map<string, Record<string, unknown>>(), rawOutput: JSON.stringify(demoResearchBundle()), usage: null }
      : await researchWithOpenAI(requireKey(apiKey), providerRequest, signal);
    const existing = parsed.excludePreviouslyResearched ? priorLeads : [];
    let validated = validateAndNormalizeLeads(providerResult.bundle, run.id, providerResult.sourceMetadata);
    let eligible = validated.filter((lead) => leadMatchesRequest(lead, parsed) && lead.priorityScore >= parsed.minimumPriorityScore);
    let qualified = prioritizeNovelLeads(eligible, existing, parsed.count);
    let rawOutput: unknown = providerResult.rawOutput;
    let usage: unknown = providerResult.usage;
    const providerWarnings = [...providerResult.bundle.warnings];

    if (!isDemoMode() && qualified.length < parsed.count) {
      reporter?.stage("researching", `Backfilling ${parsed.count - qualified.length} missing qualified opportunities across underserved customer segments.`);
      reporter?.checkpoint();
      const excludedNames = [...existing, ...validated].map((lead) => `${lead.organizationName}${lead.eventName ? ` — ${lead.eventName}` : ""}`);
      const prioritySegments = underrepresentedSegments(parsed.targetSegments, qualified);
      const backfill = await researchBackfillWithOpenAI(requireKey(apiKey), providerRequest, excludedNames, parsed.count - qualified.length, prioritySegments, signal);
      const additional = validateAndNormalizeLeads(backfill.bundle, run.id, backfill.sourceMetadata);
      validated = deduplicateLeads([...validated, ...additional]);
      eligible = validated.filter((lead) => leadMatchesRequest(lead, parsed) && lead.priorityScore >= parsed.minimumPriorityScore);
      qualified = prioritizeNovelLeads(eligible, existing, parsed.count);
      providerWarnings.push(...backfill.bundle.warnings);
      rawOutput = { primary: providerResult.rawOutput, backfill: backfill.rawOutput };
      usage = { primary: providerResult.usage, backfill: backfill.usage };
    }
    reporter?.stage("verifying", "Checking URLs, evidence, dates, and public contact claims returned by the model.");
    reporter?.checkpoint();
    const leads = qualified;
    reporter?.stage("deduplicating", "Consolidating repeated organizations while preserving every supporting source.");
    reporter?.checkpoint();
    reporter?.stage("saving", `Saving ${leads.length} inspectable opportunit${leads.length === 1 ? "y" : "ies"} locally.`);
    reporter?.checkpoint();
    saveLeads(run.id, leads);
    run.status = leads.length >= parsed.count ? "completed" : "partially_completed";
    run.resultCount = leads.length;
    const contactableCount = leads.filter((lead) => lead.contactEmail || lead.contactPageUrl).length;
    const representedSegments = new Set(leads.map((lead) => lead.targetSegment)).size;
    run.warnings = Array.from(new Set([
      ...providerWarnings,
      ...(leads.length < parsed.count ? [`Returned ${leads.length} novel opportunities meeting the ${parsed.minimumPriorityScore}-point qualification floor out of ${parsed.count} requested.`] : []),
      ...(leads.length && contactableCount / leads.length < 0.6 ? [`Only ${contactableCount} of ${leads.length} qualified opportunities have a public contact path; prioritize contact enrichment before outreach.`] : []),
      ...(leads.length >= 6 && representedSegments < 3 ? [`The qualified list spans only ${representedSegments} customer segments; broaden the next run to reduce channel concentration.`] : []),
      ...contextConflictWarnings(context)
    ]));
    run.rawOutput = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput);
    run.usage = usage as Record<string, unknown> | null;
    run.completedAt = new Date().toISOString();
    updateResearchRun(run);
    addActivity("research_completed", run.name, `${leads.filter((lead) => lead.priorityScore >= 80).length} hot · ${leads.filter((lead) => lead.priorityScore >= 65).length} sales-ready · ${contactableCount} contactable`, run.id);
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

function leadMatchesRequest(lead: ReturnType<typeof validateAndNormalizeLeads>[number], input: z.output<typeof ResearchInputSchema>) {
  if (!input.opportunityTypes.includes(lead.opportunityClass)) return false;
  if (!input.targetSegments.includes(lead.targetSegment)) return false;
  if (!input.salesMotions.includes(lead.salesMotion)) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (lead.opportunityClass === "event" && lead.eventStartDate && lead.eventStartDate < today) return false;
  const dateBounds = input.dateRange.match(/(\d{4}-\d{2}-\d{2}).*?(\d{4}-\d{2}-\d{2})/);
  if (lead.opportunityClass === "event" && lead.eventStartDate && dateBounds && (lead.eventStartDate < dateBounds[1] || lead.eventStartDate > dateBounds[2])) return false;
  const haystack = `${lead.organizationName} ${lead.organizationType} ${lead.eventName || ""} ${lead.fitExplanation} ${lead.evidenceSummary}`.toLowerCase();
  const exclusions = input.exclusionKeywords.split(/[,;\n]/).map((value) => value.trim().toLowerCase()).filter((value) => value.length >= 3);
  return !exclusions.some((exclusion) => haystack.includes(exclusion));
}

function researchMemory(leads: ReturnType<typeof listLeads>) {
  const reviewed = leads.filter((lead) => lead.reviewStatus === "reviewed");
  const rejected = leads.filter((lead) => lead.reviewStatus === "rejected");
  if (!reviewed.length && !rejected.length) return "";
  const acceptedSegments = Object.entries(Object.groupBy(reviewed, (lead) => lead.targetSegment)).map(([segment, items]) => `${segment}: ${items?.length || 0}`).join(", ");
  const rejectedSegments = Object.entries(Object.groupBy(rejected, (lead) => lead.targetSegment)).map(([segment, items]) => `${segment}: ${items?.length || 0}`).join(", ");
  const reasons = rejected.map((lead) => lead.rejectionReason?.trim()).filter(Boolean).slice(0, 12);
  return `PRIOR REVIEW FEEDBACK (use as a search preference, never as factual evidence)\nAccepted segments: ${acceptedSegments || "none yet"}\nRejected segments: ${rejectedSegments || "none"}\nRejection reasons: ${reasons.join(" | ") || "none recorded"}`.slice(0, 1200);
}

export function underrepresentedSegments(selectedSegments: string[], leads: Array<{ targetSegment: string }>) {
  const counts = new Map(selectedSegments.map((segment) => [segment, 0]));
  for (const lead of leads) if (counts.has(lead.targetSegment)) counts.set(lead.targetSegment, (counts.get(lead.targetSegment) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[1] - b[1] || selectedSegments.indexOf(a[0]) - selectedSegments.indexOf(b[0]))
    .slice(0, Math.min(5, selectedSegments.length))
    .map(([segment]) => segment);
}
