import fs from "node:fs";
import path from "node:path";
import OpenAI, { toFile } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";
import { MODELS } from "@/server/config";
import { SPEAKER_SPOTLIGHT_IMAGE_SPEC } from "@/lib/config";
import type { ContextDocument, LeadRecord, Platform } from "@/lib/types";
import { DiscoveryBundleSchema, ResearchBundleSchema, OutreachBundleSchema, SocialBundleSchema, SpeakerHeadshotQaSchema, SpeakerPostSchema, type DiscoveryBundle, type OutreachBundle, type ResearchBundle, type SocialBundle } from "./schemas";
import { buildOutreachPrompt, buildResearchBackfillPrompt, buildResearchDiscoveryPrompt, buildResearchEnrichmentPrompt, buildSocialPrompt } from "./prompts";
import { normalizeEvidenceUrl, redactSecrets } from "@/server/security/validation";

export interface ResearchRequest {
  name: string;
  objective: string;
  region: string;
  count: number;
  opportunityTypes: string[];
  organizationCategories: string[];
  eventCategories: string[];
  targetRoles: string[];
  audienceRoles: string[];
  positiveKeywords: string;
  exclusionKeywords: string;
  dateRange: string;
  notes: string;
  targetSegments: string[];
  salesMotions: string[];
  context: ContextDocument[];
}

export interface SocialRequest {
  name: string;
  brief: string;
  objective: string;
  audience: string;
  callToAction: string;
  requiredPhrases: string;
  prohibitedPhrases: string;
  headline: string;
  imageDirection: string;
  platforms: Platform[];
  context: ContextDocument[];
  webGuidancePlatforms?: Platform[];
}

export interface ProviderResearchResult {
  bundle: ResearchBundle;
  sourceMetadata: Map<string, Record<string, unknown>>;
  rawOutput: string;
  usage: Record<string, unknown> | null;
}

export type ProviderFailureCode = "invalid_key" | "rate_limited" | "model_access" | "invalid_request" | "moderation_blocked" | "server_error" | "network" | "provider_unavailable" | "malformed_output" | "refused" | "timeout" | "canceled";

export interface ProviderFailureDetails {
  status: number | null;
  providerCode: string | null;
  providerType: string | null;
  param: string | null;
  requestId: string | null;
  retryable: boolean;
  moderationStage: string | null;
  moderationCategories: string[];
}

export class ProviderFailure extends Error {
  constructor(public code: ProviderFailureCode, message: string, public details: ProviderFailureDetails = emptyProviderFailureDetails()) {
    super(message);
    this.name = "ProviderFailure";
  }
}

export const OPENAI_IMAGE_TIMEOUT_MS = 180_000;
export const OPENAI_RESEARCH_TIMEOUT_MS = 300_000;
export const OPENAI_TEXT_TIMEOUT_MS = 180_000;

function clientForKey(apiKey: string) {
  return new OpenAI({ apiKey, timeout: 90_000, maxRetries: 1 });
}

function emptyProviderFailureDetails(): ProviderFailureDetails {
  return { status: null, providerCode: null, providerType: null, param: null, requestId: null, retryable: false, moderationStage: null, moderationCategories: [] };
}

export async function validateOpenAIKey(apiKey: string) {
  try {
    const client = clientForKey(apiKey);
    await client.responses.create({
      model: MODELS.text,
      input: "Reply with OK.",
      max_output_tokens: 16,
      reasoning: { effort: "low" },
      store: false
    });
    return true;
  } catch (error) {
    throw classifyProviderError(error);
  }
}

export async function researchWithOpenAI(apiKey: string, request: ResearchRequest, signal?: AbortSignal): Promise<ProviderResearchResult> {
  try {
    const client = clientForKey(apiKey);
    const webSearchTool = researchWebSearchTool(request.region);
    const discoveryCount = Math.min(72, Math.max(24, request.count * 2));
    const discoveryResponse = await client.responses.create({
      model: MODELS.text,
      input: buildResearchDiscoveryPrompt(request, discoveryCount),
      reasoning: { effort: "medium" },
      store: false,
      tools: [webSearchTool],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      text: { format: zodTextFormat(DiscoveryBundleSchema, "summit_sales_discovery") },
      max_output_tokens: 16_000
    }, { signal, timeout: OPENAI_RESEARCH_TIMEOUT_MS, maxRetries: 0 });
    ensureNotRefused(discoveryResponse.output as unknown[]);
    const discovery = parseStructuredResponse(DiscoveryBundleSchema, discoveryResponse, "Discovery");
    const candidateBatches = planResearchCandidateBatches(discovery, request.count);
    const enrichmentResponses = await Promise.all(candidateBatches.map((batch, index) => client.responses.create({
      model: MODELS.text,
      input: buildResearchEnrichmentPrompt(request, batch, batch.length),
      reasoning: { effort: "medium" }, store: false, tools: [webSearchTool], tool_choice: "required",
      include: ["web_search_call.action.sources"],
      text: { format: zodTextFormat(ResearchBundleSchema, `summit_sales_opportunities_${index + 1}`) }, max_output_tokens: 12_000
    }, { signal, timeout: OPENAI_RESEARCH_TIMEOUT_MS, maxRetries: 0 })));
    const enrichmentBundles: ResearchBundle[] = [];
    const successfulEnrichmentResponses: typeof enrichmentResponses = [];
    const enrichmentWarnings: string[] = [];
    let firstEnrichmentFailure: ProviderFailure | null = null;
    enrichmentResponses.forEach((response, index) => {
      try {
        ensureNotRefused(response.output as unknown[]);
        enrichmentBundles.push(parseStructuredResponse(ResearchBundleSchema, response, `Enrichment batch ${index + 1}`));
        successfulEnrichmentResponses.push(response);
      } catch (error) {
        const failure = error instanceof ProviderFailure ? error : classifyProviderError(error);
        firstEnrichmentFailure ||= failure;
        enrichmentWarnings.push(`Enrichment batch ${index + 1} was skipped: ${failure.message}`);
      }
    });
    if (!enrichmentBundles.length) throw firstEnrichmentFailure || new ProviderFailure("malformed_output", "Every enrichment batch failed structured validation.");
    const bundle: ResearchBundle = {
      leads: enrichmentBundles.flatMap((item) => item.leads),
      warnings: Array.from(new Set([...discovery.warnings, ...enrichmentWarnings, ...enrichmentBundles.flatMap((item) => item.warnings)]))
    };
    const sourceMetadata = new Map<string, Record<string, unknown>>();
    for (const response of successfulEnrichmentResponses) for (const [url, metadata] of collectSourceMetadata(response.output as unknown[])) sourceMetadata.set(url, { ...(sourceMetadata.get(url) || {}), ...metadata });
    return {
      bundle,
      sourceMetadata,
      rawOutput: JSON.stringify({ discovery: discoveryResponse.output, enrichment: enrichmentResponses.map((response) => response.output) }),
      usage: { discovery: discoveryResponse.usage ? JSON.parse(JSON.stringify(discoveryResponse.usage)) : null, enrichment: enrichmentResponses.map((response) => response.usage ? JSON.parse(JSON.stringify(response.usage)) : null) }
    };
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) throw new ProviderFailure("malformed_output", "OpenAI returned research data that did not match the required schema.");
    throw classifyProviderError(error);
  }
}

export async function researchBackfillWithOpenAI(apiKey: string, request: ResearchRequest, excludedNames: string[], desiredCount: number, prioritySegments: string[], signal?: AbortSignal): Promise<ProviderResearchResult> {
  try {
    const client = clientForKey(apiKey);
    const webSearchTool = researchWebSearchTool(request.region);
    const response = await client.responses.create({
      model: MODELS.text,
      input: buildResearchBackfillPrompt(request, excludedNames, Math.min(50, Math.max(desiredCount * 2, desiredCount + 5)), prioritySegments),
      reasoning: { effort: "medium" }, store: false,
      tools: [webSearchTool],
      tool_choice: "required", include: ["web_search_call.action.sources"],
      text: { format: zodTextFormat(ResearchBundleSchema, "summit_sales_backfill") }, max_output_tokens: 16_000
    }, { signal, timeout: OPENAI_RESEARCH_TIMEOUT_MS, maxRetries: 0 });
    ensureNotRefused(response.output as unknown[]);
    return {
      bundle: parseStructuredResponse(ResearchBundleSchema, response, "Backfill"),
      sourceMetadata: collectSourceMetadata(response.output as unknown[]), rawOutput: JSON.stringify(response.output),
      usage: response.usage ? JSON.parse(JSON.stringify(response.usage)) as Record<string, unknown> : null
    };
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) throw new ProviderFailure("malformed_output", "OpenAI returned backfill data that did not match the required schema.");
    throw classifyProviderError(error);
  }
}

function rankDiscoveryCandidates(discovery: DiscoveryBundle) {
  const fit = { weak: 0, moderate: 1, strong: 2, exact: 3 } as const;
  const reach = { none: 0, limited: 1, moderate: 2, high: 3 } as const;
  const seen = new Set<string>();
  return discovery.candidates
    .filter((candidate) => {
      const key = `${candidate.organizationWebsite || candidate.organizationName}:${candidate.eventName || "organization"}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (fit[b.audienceFit] + reach[b.distributionPotential]) - (fit[a.audienceFit] + reach[a.distributionPotential]));
}

export function planResearchCandidateBatches(discovery: DiscoveryBundle, requestedCount: number) {
  const limit = Math.min(62, Math.max(requestedCount * 2, requestedCount + 12));
  const ranked = rankDiscoveryCandidates(discovery);
  const candidates = selectDiverseCandidates(ranked, limit);
  return chunk(candidates, 10);
}

export function parseStructuredResponse<T>(schema: ZodType<T>, response: { status?: string | null; incomplete_details?: unknown; output_text: string }, stage: string): T {
  if (response.status && response.status !== "completed") {
    const reason = JSON.stringify(response.incomplete_details || {}).slice(0, 240);
    throw new ProviderFailure("malformed_output", `${stage} returned an incomplete structured response${reason !== "{}" ? ` (${reason})` : ""}.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(response.output_text);
  } catch {
    throw new ProviderFailure("malformed_output", `${stage} returned invalid JSON (${response.output_text.length} characters).`);
  }
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "root"}:${issue.code}`).join(", ");
  throw new ProviderFailure("malformed_output", `${stage} did not match the required schema (${issues || "unknown validation issue"}).`);
}

function selectDiverseCandidates(candidates: DiscoveryBundle["candidates"], limit: number) {
  const selected: DiscoveryBundle["candidates"] = [];
  const selectedKeys = new Set<string>();
  const representedSegments = new Set<string>();
  const representedMotions = new Set<string>();
  const keyFor = (candidate: DiscoveryBundle["candidates"][number]) => `${candidate.organizationWebsite || candidate.organizationName}:${candidate.eventName || "organization"}`.toLowerCase();

  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (representedSegments.has(candidate.targetSegment) && representedMotions.has(candidate.salesMotion)) continue;
    selected.push(candidate);
    selectedKeys.add(keyFor(candidate));
    representedSegments.add(candidate.targetSegment);
    representedMotions.add(candidate.salesMotion);
  }
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    const key = keyFor(candidate);
    if (selectedKeys.has(key)) continue;
    selected.push(candidate);
    selectedKeys.add(key);
  }
  return selected;
}

export function researchWebSearchTool(region: string) {
  const local = /san francisco|bay area|california/i.test(region);
  return {
    type: "web_search" as const, search_context_size: "medium" as const,
    ...(local ? { user_location: { type: "approximate" as const, country: "US", city: "San Francisco", region: "California", timezone: "America/Los_Angeles" } } : {})
  };
}

function chunk<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

export async function outreachWithOpenAI(apiKey: string, input: { mode: "partner_share" | "direct_invitation" | "sales_motion"; context: ContextDocument[]; leads: LeadRecord[]; instructions: string }, signal?: AbortSignal): Promise<{ bundle: OutreachBundle; usage: Record<string, unknown> | null }> {
  try {
    const response = await clientForKey(apiKey).responses.create({
      model: MODELS.text,
      input: buildOutreachPrompt(input),
      reasoning: { effort: "low" },
      store: false,
      text: { format: zodTextFormat(OutreachBundleSchema, "outreach_campaign") },
      max_output_tokens: 8_000
    }, { signal, timeout: OPENAI_TEXT_TIMEOUT_MS, maxRetries: 0 });
    ensureNotRefused(response.output as unknown[]);
    return { bundle: OutreachBundleSchema.parse(JSON.parse(response.output_text)), usage: response.usage ? JSON.parse(JSON.stringify(response.usage)) as Record<string, unknown> : null };
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) throw new ProviderFailure("malformed_output", "OpenAI returned outreach data that did not match the required schema.");
    throw classifyProviderError(error);
  }
}

export async function socialWithOpenAI(apiKey: string, input: SocialRequest, signal?: AbortSignal): Promise<{ bundle: SocialBundle; usage: Record<string, unknown> | null }> {
  try {
    const needsWebGuidance = Boolean(input.webGuidancePlatforms?.length);
    const response = await clientForKey(apiKey).responses.create({
      model: MODELS.text,
      input: buildSocialPrompt(input),
      reasoning: { effort: "low" },
      store: false,
      ...(needsWebGuidance ? { tools: [{ type: "web_search" as const, search_context_size: "medium" as const }], tool_choice: "required" as const } : {}),
      text: { format: zodTextFormat(SocialBundleSchema, "social_campaign") },
      max_output_tokens: 8_000
    }, { signal, timeout: OPENAI_TEXT_TIMEOUT_MS, maxRetries: 0 });
    ensureNotRefused(response.output as unknown[]);
    return { bundle: SocialBundleSchema.parse(JSON.parse(response.output_text)), usage: response.usage ? JSON.parse(JSON.stringify(response.usage)) as Record<string, unknown> : null };
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) throw new ProviderFailure("malformed_output", "OpenAI returned social content that did not match the required schema.");
    throw classifyProviderError(error);
  }
}

export async function imageWithOpenAI(apiKey: string, prompt: string, size: "1024x1024" | "1536x1024" | "1024x1536" = "1024x1024", signal?: AbortSignal) {
  try {
    const result = await clientForKey(apiKey).images.generate({ model: MODELS.image, prompt, size, quality: "low", output_format: "png" }, { signal, timeout: OPENAI_IMAGE_TIMEOUT_MS, maxRetries: 0 });
    const encoded = result.data?.[0]?.b64_json;
    if (!encoded) throw new ProviderFailure("provider_unavailable", "OpenAI did not return image data.");
    return Buffer.from(encoded, "base64");
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    throw classifyProviderError(error);
  }
}

export async function speakerSpotlightImageWithOpenAI(apiKey: string, input: { headshotPath: string; headshotMimeType: string; styleReferencePath: string; organizationLogoPath: string; organizationLogoMimeType: string; prompt: string }, signal?: AbortSignal) {
  try {
    const client = clientForKey(apiKey);
    const styleReferenceMimeType = /\.jpe?g$/i.test(input.styleReferencePath) ? "image/jpeg" : /\.webp$/i.test(input.styleReferencePath) ? "image/webp" : "image/png";
    const images = await Promise.all([
      toFile(fs.createReadStream(input.headshotPath), path.basename(input.headshotPath), { type: input.headshotMimeType }),
      toFile(fs.createReadStream(input.styleReferencePath), path.basename(input.styleReferencePath), { type: styleReferenceMimeType }),
      toFile(fs.createReadStream(input.organizationLogoPath), path.basename(input.organizationLogoPath), { type: input.organizationLogoMimeType })
    ]);
    const result = await client.images.edit(buildSpeakerSpotlightImageEditRequest(images, input.prompt), { signal, timeout: OPENAI_IMAGE_TIMEOUT_MS, maxRetries: 0 });
    const encoded = result.data?.[0]?.b64_json;
    if (!encoded) throw new ProviderFailure("provider_unavailable", "OpenAI did not return Speaker Spotlight image data.");
    return { bytes: Buffer.from(encoded, "base64"), requestId: (result as unknown as { _request_id?: string })._request_id || null };
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    throw classifyProviderError(error);
  }
}

export function buildSpeakerSpotlightImageEditRequest(image: Awaited<ReturnType<typeof toFile>>[], prompt: string) {
  return {
    model: "gpt-image-2",
    image,
    prompt,
    size: SPEAKER_SPOTLIGHT_IMAGE_SPEC.size,
    quality: "high",
    output_format: "png"
  } as const;
}

export async function speakerPostWithOpenAI(apiKey: string, input: { prompt: string }, signal?: AbortSignal) {
  try {
    const response = await clientForKey(apiKey).responses.create({
      model: MODELS.text,
      input: input.prompt,
      reasoning: { effort: "low" },
      store: false,
      text: { format: zodTextFormat(SpeakerPostSchema, "speaker_spotlight_post") },
      max_output_tokens: 4_000
    }, { signal, timeout: OPENAI_TEXT_TIMEOUT_MS, maxRetries: 0 });
    ensureNotRefused(response.output as unknown[]);
    return { bundle: SpeakerPostSchema.parse(JSON.parse(response.output_text)), requestId: response._request_id || null, usage: response.usage ? JSON.parse(JSON.stringify(response.usage)) as Record<string, unknown> : null };
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) throw new ProviderFailure("malformed_output", "OpenAI returned a Speaker Spotlight post that did not match the required schema.");
    throw classifyProviderError(error);
  }
}

export async function speakerHeadshotQaWithOpenAI(apiKey: string, input: { speakerName: string; headshotPath: string; mimeType: string }, signal?: AbortSignal) {
  try {
    const imageUrl = `data:${input.mimeType};base64,${fs.readFileSync(input.headshotPath).toString("base64")}`;
    const response = await clientForKey(apiKey).responses.create({
      model: MODELS.text,
      input: [{ role: "user", content: [
        { type: "input_text", text: `Check whether this locally matched AGI Summit headshot for ${input.speakerName} contains at least one discernible human face. This is not a request to infer identity from appearance. Set faceVisible to true whenever a human face can be seen, even if the image has rough masking, jagged cutout edges, a poor background removal, low resolution, unusual framing, multiple people, or other cosmetic defects. Set faceVisible to false only when no human face is discernible. Record quality concerns in issues; they are warnings and must not change faceVisible. Keep the remaining quality fields as descriptive diagnostics.` },
        { type: "input_image", image_url: imageUrl, detail: "high" }
      ] }],
      reasoning: { effort: "low" }, store: false,
      text: { format: zodTextFormat(SpeakerHeadshotQaSchema, "speaker_headshot_qa") }, max_output_tokens: 1_000
    }, { signal, timeout: OPENAI_TEXT_TIMEOUT_MS, maxRetries: 0 });
    ensureNotRefused(response.output as unknown[]);
    return { bundle: SpeakerHeadshotQaSchema.parse(JSON.parse(response.output_text)), requestId: response._request_id || null };
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) throw new ProviderFailure("malformed_output", "OpenAI returned headshot QA that did not match the required schema.");
    throw classifyProviderError(error);
  }
}

export function collectSourceMetadata(output: unknown[]) {
  const metadata = new Map<string, Record<string, unknown>>();
  const mergeMetadata = (url: unknown, patch: Record<string, unknown>) => {
    if (typeof url !== "string") return;
    const canonicalUrl = canonicalProviderUrl(url);
    if (!canonicalUrl) return;
    metadata.set(canonicalUrl, { ...(metadata.get(canonicalUrl) || {}), ...patch });
  };
  for (const item of output as Array<Record<string, unknown>>) {
    const action = item.action as Record<string, unknown> | undefined;
    for (const source of (action?.sources as Array<Record<string, unknown>> | undefined) || []) mergeMetadata(source.url, { webSearchSource: source });
    if (action?.url) mergeMetadata(action.url, { webSearchAction: action });
    for (const content of (item.content as Array<Record<string, unknown>> | undefined) || []) {
      for (const annotation of (content.annotations as Array<Record<string, unknown>> | undefined) || []) if (typeof annotation.url === "string") {
        const canonicalUrl = canonicalProviderUrl(annotation.url);
        if (!canonicalUrl) continue;
        const current = metadata.get(canonicalUrl) || {};
        const annotations = Array.isArray(current.annotations) ? current.annotations : [];
        metadata.set(canonicalUrl, { ...current, annotations: [...annotations, annotation] });
      }
    }
  }
  return metadata;
}

function canonicalProviderUrl(value: string) {
  return normalizeEvidenceUrl(value);
}

function ensureNotRefused(output: unknown[]) {
  for (const item of output as Array<Record<string, unknown>>) {
    for (const content of (item.content as Array<Record<string, unknown>> | undefined) || []) {
      if (content.type === "refusal" || typeof content.refusal === "string") throw new ProviderFailure("refused", "OpenAI declined this request. Revise the input and try again.");
    }
  }
}

export function classifyProviderError(error: unknown) {
  if (error instanceof ProviderFailure) return error;
  const record = asRecord(error);
  const body = asRecord(record.error);
  const statusValue = Number(record.status);
  const status = Number.isFinite(statusValue) && statusValue > 0 ? statusValue : null;
  const providerCode = safeProviderValue(record.code ?? body.code);
  const providerType = safeProviderValue(record.type ?? body.type);
  const param = safeProviderValue(record.param ?? body.param);
  const requestId = safeProviderValue(record.requestID ?? record.request_id ?? body.request_id);
  const moderation = asRecord(record.moderation_details ?? body.moderation_details);
  const moderationStage = safeProviderValue(moderation.moderation_stage);
  const moderationCategories = Array.isArray(moderation.categories) ? moderation.categories.map(safeProviderValue).filter((value): value is string => Boolean(value)).slice(0, 8) : [];
  const details = (retryable: boolean): ProviderFailureDetails => ({ status, providerCode, providerType, param, requestId, retryable, moderationStage, moderationCategories });
  const message = redactSecrets(error instanceof Error ? error.message : String(error));
  if ((error instanceof Error && error.name === "AbortError") || /aborted|canceled/i.test(message)) return new ProviderFailure("canceled", appendProviderReference("The OpenAI operation was canceled.", requestId), details(false));
  if (status === 401) return new ProviderFailure("invalid_key", appendProviderReference("The API key was rejected. Check the key and try again.", requestId), details(false));
  if (status === 429) return new ProviderFailure("rate_limited", appendProviderReference("OpenAI rate or quota limits prevented this request. Wait or review the key’s billing limits, then retry.", requestId), details(true));
  if (status === 403 || providerCode?.includes("permission") || providerCode?.includes("verification")) return new ProviderFailure("model_access", appendProviderReference("This key does not have access to the requested model or requires organization verification.", requestId), details(false));
  if (status === 404 && providerCode?.includes("model")) return new ProviderFailure("model_access", appendProviderReference("The configured OpenAI model is unavailable for this key.", requestId), details(false));
  if (providerCode === "moderation_blocked") return new ProviderFailure("moderation_blocked", appendProviderReference("Image generation was blocked by a safety check. Revise the visual prompt or inputs and retry; saved verified content was preserved.", requestId), details(false));
  if (status === 400 || status === 409 || status === 422 || providerType === "image_generation_user_error") {
    const diagnostic = [providerCode ? `code ${providerCode}` : null, param ? `parameter ${param}` : null].filter(Boolean).join(", ");
    return new ProviderFailure("invalid_request", appendProviderReference(`OpenAI rejected the request${diagnostic ? ` (${diagnostic})` : ""}. Correct the request or inputs before retrying.`, requestId), details(false));
  }
  if (status !== null && status >= 500) return new ProviderFailure("server_error", appendProviderReference("OpenAI temporarily failed while processing the request. Retry the preserved package.", requestId), details(true));
  if (/timeout|timed out/i.test(message) || (error instanceof Error && error.name === "APIConnectionTimeoutError")) return new ProviderFailure("timeout", appendProviderReference("The OpenAI request timed out. Retry the preserved package.", requestId), details(true));
  if (/fetch|network|ECONN|ENOTFOUND|offline|connection/i.test(message)) return new ProviderFailure("network", appendProviderReference("The local server could not reach OpenAI. Check the internet connection and retry the preserved package.", requestId), details(true));
  return new ProviderFailure("provider_unavailable", appendProviderReference("OpenAI could not complete the request. The verified package inputs were preserved for retry.", requestId), details(true));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function safeProviderValue(value: unknown) {
  if (typeof value !== "string") return null;
  const sanitized = redactSecrets(value).replace(/[^a-zA-Z0-9_.:/-]/g, "").slice(0, 180);
  return sanitized || null;
}

function appendProviderReference(message: string, requestId: string | null) {
  return requestId ? `${message} OpenAI request: ${requestId}.` : message;
}
