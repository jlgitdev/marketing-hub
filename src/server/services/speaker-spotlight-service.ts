import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { PROMPT_VERSIONS, SPEAKER_SPOTLIGHT_IMAGE_SPEC } from "@/lib/config";
import type { SpeakerProfile, SpeakerSpotlightBatch, SpeakerSpotlightImageAttemptResult, SpeakerSpotlightProviderError, SpeakerSpotlightQa, SpeakerSpotlightResult, SpeakerSpotlightStage } from "@/lib/types";
import { agiSummitSiteDirectory, dataDirectory, isDemoMode, projectContextDirectory } from "@/server/config";
import { createSpeakerSpotlightBatch, listSpeakerSpotlightBatches, speakerSpotlightResultStorage, updateSpeakerSpotlightBatch, updateSpeakerSpotlightResult } from "@/server/db/repository";
import { ProviderFailure, speakerHeadshotQaWithOpenAI, speakerPostWithOpenAI, speakerSpotlightImageWithOpenAI } from "@/server/ai/openai-provider";
import { escapeXml, safeFileName } from "@/server/security/validation";
import { OperationCanceledError, type OperationReporter } from "@/server/operations/types";
import { stripC2paFromFile, writeC2paStrippedImage } from "@/server/images/strip-c2pa";

const DEFAULT_CONFIG = {
  eventName: "AGI Summit SF 2026",
  eventDates: "July 18–19, 2026",
  eventVenue: "Palace of Fine Arts, San Francisco",
  eventWebsite: "agisummit.ai",
  ticketUrl: "https://luma.com/agisummit2026?coupon=JAMES",
  discountCopy: "15% off automatically applied through the link",
  siteDirectory: agiSummitSiteDirectory()
};

interface SpeakerOrganizationBrand {
  name: string;
  sourcePath: string | null;
  sourceFileName: string | null;
  fallbackText?: string;
  verificationMethod: string;
}

export function headshotQaAllowsGeneration(qa: { faceVisible: boolean }) {
  return qa.faceVisible;
}

export const SpeakerSpotlightInputSchema = z.object({
  speakerNames: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
  config: z.object({
    eventName: z.string().min(2).max(160).default(DEFAULT_CONFIG.eventName),
    eventDates: z.string().min(2).max(160).default(DEFAULT_CONFIG.eventDates),
    eventVenue: z.string().min(2).max(220).default(DEFAULT_CONFIG.eventVenue),
    eventWebsite: z.string().min(2).max(220).default(DEFAULT_CONFIG.eventWebsite),
    ticketUrl: z.string().url().max(500).default(DEFAULT_CONFIG.ticketUrl),
    discountCopy: z.string().min(2).max(300).default(DEFAULT_CONFIG.discountCopy),
    siteDirectory: z.string().min(1).max(1000).default(DEFAULT_CONFIG.siteDirectory)
  }).partial().default({})
});

export const SpeakerSpotlightRetrySchema = z.object({ resultId: z.string().uuid() });
export const SpeakerSpotlightReviewSchema = z.object({ resultId: z.string().uuid(), decision: z.literal("approve") });

export function speakerSpotlightDefaults() {
  return DEFAULT_CONFIG;
}

export async function createSpeakerSpotlights(input: z.input<typeof SpeakerSpotlightInputSchema>, apiKey: string | null, reporter?: OperationReporter) {
  const parsed = SpeakerSpotlightInputSchema.parse(input);
  const names = Array.from(new Set(parsed.speakerNames.map((name) => name.trim()).filter(Boolean)));
  if (!names.length) throw new Error("Enter at least one speaker name.");
  if (!isDemoMode() && !apiKey) throw new Error("Connect an OpenAI API key before generating live Speaker Spotlights.");
  const config = { ...DEFAULT_CONFIG, ...parsed.config, siteDirectory: path.resolve(parsed.config.siteDirectory || DEFAULT_CONFIG.siteDirectory) };
  const references = verifyReferences(config.siteDirectory);
  const now = new Date().toISOString();
  const batchId = crypto.randomUUID();
  const results: SpeakerSpotlightResult[] = names.map((name, index) => ({
    id: crypto.randomUUID(), batchId, inputName: name, profileKey: normalizeProfileKey(name), slug: speakerSlug(name), status: "queued",
    profile: null, post: null, headshotFileName: null, imageFileName: null, headshotAssetId: null, imageAssetId: null,
    imagePrompt: null, qa: null, requestIds: [], retryCount: 0, providerError: null, error: null,
    createdAt: new Date(Date.now() + index).toISOString(), updatedAt: now
  }));
  const batch: SpeakerSpotlightBatch = {
    id: batchId, speakerNames: names, status: "running", config, model: isDemoMode() ? "demo-image-v1" : "gpt-image-2",
    promptVersion: PROMPT_VERSIONS.speakerSpotlight, provider: isDemoMode() ? "demo" : "openai", warnings: [], error: null,
    createdAt: now, completedAt: null, results
  };
  createSpeakerSpotlightBatch(batch);
  const batchRoot = path.join(dataDirectory(), "speaker_spotlights", batchId);
  fs.mkdirSync(batchRoot, { recursive: true });

  reporter?.stage("processing", `0 of ${results.length} speaker packages complete.`);
  let processed = 0;
  try {
    await mapWithConcurrency(results, 2, async (result) => {
      await processSpeaker({ result, config, references, batchRoot, apiKey, reporter });
      processed += 1;
      reporter?.progress(processed, results.length, "speakers", `${processed} of ${results.length} speaker packages processed.`);
      writeManifest(batchId, batchRoot);
    });

    reporter?.stage("finalizing", "Grouping completed packages and writing the local batch manifest.");
    reporter?.checkpoint();
    finalizeBatch(batchId);
    writeManifest(batchId, batchRoot);
  } catch (error) {
    const current = listSpeakerSpotlightBatches().find((item) => item.id === batchId);
    for (const untouched of current?.results.filter((result) => result.status === "queued") || []) {
      updateSpeakerSpotlightResult(untouched.id, { status: "canceled", error: "Canceled before this speaker package started." });
    }
    finalizeBatch(batchId);
    writeManifest(batchId, batchRoot);
    throw error;
  }
  return listSpeakerSpotlightBatches().find((item) => item.id === batchId)!;
}

async function processSpeaker(input: {
  result: SpeakerSpotlightResult;
  config: SpeakerSpotlightBatch["config"];
  references: ReturnType<typeof verifyReferences>;
  batchRoot: string;
  apiKey: string | null;
  reporter?: OperationReporter;
}) {
  const { result, config, references, batchRoot, apiKey, reporter } = input;
  const speakerDirectory = path.join(batchRoot, result.slug);
  fs.mkdirSync(speakerDirectory, { recursive: true });
  let stage: SpeakerSpotlightStage = "profile_extraction";
  try {
    reporter?.checkpoint();
    reporter?.stage("processing", `${result.inputName} · reading the verified local speaker profile.`);
    updateSpeakerSpotlightResult(result.id, { status: "extracting", providerError: null, error: null });
    const profile = extractSpeakerProfile(result.inputName, references.bundlePath);
    const organizationName = inferOrganizationName(profile) || "AGI Summit";
    const profilePath = path.join(speakerDirectory, `${result.slug}-profile.json`);
    fs.writeFileSync(profilePath, `${JSON.stringify({ ...profile, spotlightOrganization: { name: organizationName, verificationMethod: "organization name extracted from the verified speaker profile for personalized copy only" } }, null, 2)}\n`);

    stage = "headshot_match";
    reporter?.stage("processing", `${result.inputName} · matching a local headshot to the verified profile.`);
    updateSpeakerSpotlightResult(result.id, { status: "matching_headshot" });
    reporter?.checkpoint();
    const headshot = await findVerifiedHeadshot(result.inputName, profile.profileKey, config.siteDirectory, references.extractionGuidePath, references.headshotManifestPath);
    const headshotFileName = `${result.slug}-headshot${headshot.extension}`;
    const headshotPath = path.join(speakerDirectory, headshotFileName);
    fs.copyFileSync(headshot.path, headshotPath);
    const headshotAssetId = crypto.randomUUID();
    const preRequestIds: string[] = [];
    const headshotWarnings: string[] = [];
    let headshotVerificationMethod = headshot.verificationMethod;
    if (!isDemoMode()) {
      stage = "headshot_qa";
      reporter?.stage("processing", `${result.inputName} · confirming that the matched headshot contains a visible face.`);
      updateSpeakerSpotlightResult(result.id, { status: "checking_headshot" });
      reporter?.checkpoint();
      try {
        const visualQa = await speakerHeadshotQaWithOpenAI(apiKey!, { speakerName: result.inputName, headshotPath, mimeType: headshot.mimeType }, reporter?.signal);
        if (visualQa.requestId) preRequestIds.push(visualQa.requestId);
        if (!headshotQaAllowsGeneration(visualQa.bundle)) throw new Error(`The matched headshot for ${result.inputName} does not contain a discernible human face.`);
        headshotWarnings.push(...visualQa.bundle.issues.map((issue) => `Headshot source warning (generation continued): ${issue}`));
        headshotVerificationMethod = `${headshot.verificationMethod}; visual check confirmed a discernible human face and cosmetic findings were treated as warnings`;
      } catch (error) {
        if (!(error instanceof ProviderFailure)) throw error;
        if (error.details.requestId) preRequestIds.push(error.details.requestId);
        headshotWarnings.push(`Headshot face check was unavailable, so generation continued with the locally matched site headshot: ${error.message}`);
        headshotVerificationMethod = `${headshot.verificationMethod}; automated face check unavailable, continued with the locally matched site headshot`;
      }
    }
    updateSpeakerSpotlightResult(result.id, {
      profileKey: profile.profileKey, profile, status: "ready_for_image", headshotFileName, headshotAssetId,
      headshotStoragePath: headshotPath, requestIds: preRequestIds
    });

    const frozen = freezeCardCopy(profile, organizationName);
    const imagePrompt = buildImagePrompt(profile, frozen, config);
    fs.writeFileSync(path.join(speakerDirectory, `${result.slug}-image-prompt.md`), imagePrompt);
    updateSpeakerSpotlightResult(result.id, { status: "ready_for_image", imagePrompt });
    await completeVerifiedSpeakerPackage({ result, profile, imagePrompt, headshotPath, headshotMimeType: headshot.mimeType, headshotVerificationMethod, headshotWarnings, styleReferencePath: references.styleReferencePath, organizationName, captionExample: references.captionExample, speakerDirectory, config, apiKey, requestIds: preRequestIds, existingPost: null, retryCount: 0, reporter });
  } catch (error) {
    recordSpeakerFailure(result.id, stage, error);
  }
}

export async function retrySpeakerSpotlight(resultId: string, apiKey: string | null, reporter?: OperationReporter) {
  if (!isDemoMode() && !apiKey) throw new Error("Connect an OpenAI API key before retrying a live Speaker Spotlight.");
  const batch = listSpeakerSpotlightBatches().find((item) => item.results.some((result) => result.id === resultId));
  const result = batch?.results.find((item) => item.id === resultId);
  if (!batch || !result) throw new Error("Speaker Spotlight result not found.");
  if (!result.profile || !result.imagePrompt || !result.headshotFileName) throw new Error("This result cannot be resumed because its verified profile, prompt, or headshot is missing.");
  if (!['failed', 'image_review_required'].includes(result.status)) throw new Error("Only failed or review-required Speaker Spotlights can be retried.");
  const storage = speakerSpotlightResultStorage(result.id);
  if (!storage?.headshotPath || !fs.existsSync(storage.headshotPath)) throw new Error("The preserved verified headshot is unavailable, so this package cannot be resumed.");
  const metadata = await sharp(storage.headshotPath).metadata();
  const headshotMimeType = metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format || "png"}`;
  const references = verifyReferences(batch.config.siteDirectory);
  const batchRoot = path.join(dataDirectory(), "speaker_spotlights", batch.id);
  const speakerDirectory = path.dirname(storage.headshotPath);
  const organizationName = inferOrganizationName(result.profile) || "AGI Summit";
  const frozen = freezeCardCopy(result.profile, organizationName);
  const imagePrompt = buildImagePrompt(result.profile, frozen, batch.config);
  updateSpeakerSpotlightBatch(batch.id, { status: "running", warnings: [], error: null, completedAt: null });
  updateSpeakerSpotlightResult(result.id, { status: "ready_for_image", imagePrompt, providerError: null, error: null, retryCount: result.retryCount + 1 });
  try {
    reporter?.stage("processing", `${result.profile.displayName} · generating one image from the preserved package.`);
    reporter?.checkpoint();
    await completeVerifiedSpeakerPackage({
      result, profile: result.profile, imagePrompt, headshotPath: storage.headshotPath, headshotMimeType,
      headshotVerificationMethod: result.qa?.headshotVerificationMethod || "preserved verified headshot from the original run",
      styleReferencePath: references.styleReferencePath, organizationName, captionExample: references.captionExample, speakerDirectory,
      config: batch.config, apiKey, requestIds: result.requestIds, existingPost: result.post, retryCount: result.retryCount + 1, reporter
    });
  } catch (error) {
    recordSpeakerFailure(result.id, "finalization", error);
  }
  finalizeBatch(batch.id);
  writeManifest(batch.id, batchRoot);
  return listSpeakerSpotlightBatches().find((item) => item.id === batch.id)!;
}

export async function approveSpeakerSpotlightImage(resultId: string) {
  const batch = listSpeakerSpotlightBatches().find((item) => item.results.some((result) => result.id === resultId));
  const result = batch?.results.find((item) => item.id === resultId);
  if (!batch || !result) throw new Error("Speaker Spotlight result not found.");
  if (!["image_review_required", "failed", "canceled"].includes(result.status)) throw new Error("Only a saved incomplete Speaker Spotlight image can be promoted.");
  const storage = speakerSpotlightResultStorage(result.id);
  const speakerDirectory = storage?.headshotPath ? path.dirname(storage.headshotPath) : path.join(dataDirectory(), "speaker_spotlights", batch.id, result.slug);
  const preservedAttemptPath = path.join(speakerDirectory, `${result.slug}-speaker-spotlight-attempt-1.png`);
  const sourcePath = storage?.imagePath && fs.existsSync(storage.imagePath) ? storage.imagePath : preservedAttemptPath;
  if (!fs.existsSync(sourcePath)) throw new Error("The saved first image is unavailable.");
  await validateFirstImageOutput(sourcePath);

  const approvedFileName = `${result.slug}-speaker-spotlight.png`;
  const approvedPath = path.join(speakerDirectory, approvedFileName);
  writeC2paStrippedImage(approvedPath, fs.readFileSync(sourcePath));
  const reviewedAt = new Date().toISOString();
  const qa = result.qa
    ? { ...result.qa, humanReviewApprovedAt: reviewedAt }
    : firstOutputValidationRecord({ headshotVerificationMethod: "preserved verified headshot from the original run", postFactsVerified: Boolean(result.post), imageRequestId: null, humanReviewApprovedAt: reviewedAt });
  fs.writeFileSync(path.join(speakerDirectory, `${result.slug}-qa.json`), `${JSON.stringify({ speaker: result.profile?.displayName || result.inputName, ...snakeCaseQa(qa), status: "completed" }, null, 2)}\n`);
  updateSpeakerSpotlightResult(result.id, {
    status: "completed",
    imageFileName: approvedFileName,
    imageAssetId: result.imageAssetId || crypto.randomUUID(),
    imageStoragePath: approvedPath,
    qa,
    providerError: null,
    error: null
  });
  finalizeBatch(batch.id);
  writeManifest(batch.id, path.join(dataDirectory(), "speaker_spotlights", batch.id));
  return listSpeakerSpotlightBatches().find((item) => item.id === batch.id)!;
}

async function completeVerifiedSpeakerPackage(input: {
  result: SpeakerSpotlightResult; profile: SpeakerProfile; imagePrompt: string; headshotPath: string; headshotMimeType: string;
  headshotVerificationMethod: string; headshotWarnings?: string[]; styleReferencePath: string; organizationName: string; captionExample: string; speakerDirectory: string;
  config: SpeakerSpotlightBatch["config"]; apiKey: string | null; requestIds: string[]; existingPost: string | null; retryCount: number;
  reporter?: OperationReporter;
}) {
  const frozen = freezeCardCopy(input.profile, input.organizationName);
  let requestIds = uniqueRequestIds(input.requestIds);
  let post = input.existingPost;
  let postWarnings: string[] = [];
  if (!post) {
    input.reporter?.stage("processing", `${input.profile.displayName} · writing and validating the cross-platform caption.`);
    input.reporter?.checkpoint();
    updateSpeakerSpotlightResult(input.result.id, { status: "writing_post", providerError: null, error: null });
    try {
      const postPrompt = buildPostPrompt(input.profile, input.config, input.captionExample);
      const postResult = isDemoMode() ? { post: demoPost(input.profile, input.config), requestId: null, warnings: [] as string[], factualClaimsUsed: [] as string[] } : await generatePost(input.apiKey!, postPrompt, input.reporter?.signal);
      validatePost(postResult.post, input.profile, input.config, postResult.factualClaimsUsed);
      post = postResult.post.trim();
      postWarnings = postResult.warnings;
      requestIds = uniqueRequestIds([...requestIds, ...(postResult.requestId ? [postResult.requestId] : [])]);
      fs.writeFileSync(path.join(input.speakerDirectory, `${input.result.slug}-post.md`), `${post}\n`);
      updateSpeakerSpotlightResult(input.result.id, { post, requestIds });
    } catch (error) {
      throw new SpeakerSpotlightPipelineFailure("caption_generation", error);
    }
  }

  input.reporter?.stage("processing", `${input.profile.displayName} · generating the first and final 2:3 image.`);
  input.reporter?.checkpoint();
  updateSpeakerSpotlightResult(input.result.id, { status: "generating_image", providerError: null, error: null });
  const imageResult = await generateFirstImage({ result: input.result, profile: input.profile, frozen, imagePrompt: input.imagePrompt, headshotPath: input.headshotPath, headshotMimeType: input.headshotMimeType, styleReferencePath: input.styleReferencePath, speakerDirectory: input.speakerDirectory, config: input.config, apiKey: input.apiKey, priorRequestIds: requestIds, reporter: input.reporter });
  requestIds = uniqueRequestIds([...requestIds, ...imageResult.requestIds]);
  updateSpeakerSpotlightResult(input.result.id, {
    imageFileName: imageResult.imageFileName, imageAssetId: imageResult.imageAssetId, imageStoragePath: imageResult.imagePath,
    requestIds, retryCount: input.retryCount
  });

  const qa = firstOutputValidationRecord({
    headshotVerificationMethod: input.headshotVerificationMethod,
    postFactsVerified: Boolean(post),
    imageRequestId: imageResult.imageRequestId,
    issues: [...(input.headshotWarnings || []), ...postWarnings]
  });
  fs.writeFileSync(path.join(input.speakerDirectory, `${input.result.slug}-qa.json`), `${JSON.stringify({ speaker: input.profile.displayName, ...snakeCaseQa(qa), status: "completed" }, null, 2)}\n`);
  input.reporter?.stage("processing", `${input.profile.displayName} · finalizing the first image, caption, and validation record.`);
  input.reporter?.checkpoint();
  updateSpeakerSpotlightResult(input.result.id, { status: "finalizing" });
  updateSpeakerSpotlightResult(input.result.id, {
    status: "completed", post, qa, requestIds, providerError: null, error: null
  });
}

class SpeakerSpotlightPipelineFailure extends Error {
  constructor(public stage: SpeakerSpotlightStage, public sourceError: unknown) {
    super(sourceError instanceof Error ? sourceError.message : "Speaker Spotlight generation failed.");
    this.name = "SpeakerSpotlightPipelineFailure";
  }
}

function recordSpeakerFailure(resultId: string, fallbackStage: SpeakerSpotlightStage, error: unknown) {
  const stage = error instanceof SpeakerSpotlightPipelineFailure ? error.stage : fallbackStage;
  const sourceError = error instanceof SpeakerSpotlightPipelineFailure ? error.sourceError : error;
  const message = sourceError instanceof Error ? sourceError.message : "Speaker Spotlight generation failed.";
  const providerError: SpeakerSpotlightProviderError | null = sourceError instanceof ProviderFailure ? {
    stage,
    code: sourceError.code,
    status: sourceError.details.status,
    providerCode: sourceError.details.providerCode,
    providerType: sourceError.details.providerType,
    param: sourceError.details.param,
    requestId: sourceError.details.requestId,
    retryable: sourceError.details.retryable,
    moderationStage: sourceError.details.moderationStage,
    moderationCategories: sourceError.details.moderationCategories
  } : null;
  const current = listSpeakerSpotlightBatches().flatMap((batch) => batch.results).find((result) => result.id === resultId);
  const requestIds = uniqueRequestIds([...(current?.requestIds || []), ...(providerError?.requestId ? [providerError.requestId] : [])]);
  const extractionFailure = stage === "profile_extraction" || stage === "headshot_match" || stage === "headshot_qa";
  const canceled = error instanceof OperationCanceledError || (sourceError instanceof ProviderFailure && sourceError.code === "canceled") || /cancel|abort/i.test(message);
  updateSpeakerSpotlightResult(resultId, { status: canceled ? "canceled" : extractionFailure ? "extraction_failed" : "failed", requestIds, providerError, error: canceled ? "Canceled before this speaker package completed." : message });
}

function finalizeBatch(batchId: string) {
  const batch = listSpeakerSpotlightBatches().find((item) => item.id === batchId);
  if (!batch) throw new Error("Speaker Spotlight batch not found.");
  const completed = batch.results.filter((result) => result.status === "completed").length;
  const review = batch.results.filter((result) => result.status === "image_review_required").length;
  const partial = batch.results.filter((result) => result.post || result.imageAssetId).length;
  const status: SpeakerSpotlightBatch["status"] = completed === batch.results.length ? "completed" : completed || review || partial ? "partially_completed" : "failed";
  const warnings = [
    ...(review ? [`${review} legacy speaker image${review === 1 ? " is" : "s are"} awaiting review.`] : []),
    ...(status === "partially_completed" && batch.results.some((result) => result.status === "failed") ? ["One or more verified partial packages were preserved and can be retried without repeating extraction."] : [])
  ];
  updateSpeakerSpotlightBatch(batchId, {
    status,
    warnings,
    error: status === "failed" ? "No speaker package completed. Review the per-speaker errors and retry preserved packages where available." : null,
    completedAt: new Date().toISOString()
  });
}

function uniqueRequestIds(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function verifyReferences(siteDirectory: string) {
  const contextDirectory = projectContextDirectory();
  const required = {
    creationGuidePath: findNamedFile(contextDirectory, /speaker spotlight creation guide\.md$/i),
    extractionGuidePath: findNamedFile(contextDirectory, /speaker.*extraction.*guide\.md$/i),
    styleReferencePath: findNamedFile(contextDirectory, /speaker spotlight social media image reference v3\.(?:png|jpe?g|webp)$/i),
    captionExamplePath: findNamedFile(contextDirectory, /example.*speaker.*spotlight.*\.md$/i),
    headshotManifestPath: walkFiles(contextDirectory).find((candidate) => /headshot.*manifest\.json$/i.test(path.basename(candidate))) || null
  };
  if (!fs.existsSync(siteDirectory) || !fs.statSync(siteDirectory).isDirectory()) throw new Error(`The configured downloaded AGI Summit site directory is unavailable: ${siteDirectory}`);
  const bundlePath = walkFiles(siteDirectory).filter((file) => /index-.*\.js$/i.test(path.basename(file))).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
  if (!bundlePath) throw new Error("No index-*.js bundle was found in the configured downloaded AGI Summit site directory.");
  return { ...required, bundlePath, captionExample: fs.readFileSync(required.captionExamplePath, "utf8") };
}

function findNamedFile(directory: string, pattern: RegExp) {
  const file = walkFiles(directory).find((candidate) => pattern.test(path.basename(candidate)));
  if (!file || !fs.statSync(file).isFile()) throw new Error(`Required Speaker Spotlight reference is missing: ${pattern.source}`);
  return file;
}

export function normalizeProfileKey(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function extractSpeakerProfile(inputName: string, bundlePath: string): SpeakerProfile {
  const profileKey = normalizeProfileKey(inputName);
  const source = fs.readFileSync(bundlePath, "utf8");
  const marker = new RegExp(`(?:^|[,{}])${escapeRegExp(profileKey)}\\s*:\\s*\\{`, "i");
  const match = marker.exec(source);
  if (!match) throw new Error(`No verified AGI Summit profile record was found for ${inputName}.`);
  const braceIndex = source.indexOf("{", match.index + match[0].lastIndexOf(profileKey));
  const objectText = extractBalanced(source, braceIndex, "{", "}");
  const xUrl = readStringField(objectText, "x");
  const profile: SpeakerProfile = {
    inputName, displayName: inputName, profileKey,
    subtitle: readStringField(objectText, "sub"), roleLine: readStringField(objectText, "roleLine"), bio: readStringField(objectText, "bio"),
    highlights: readObjectArray(objectText, "highlights").map((item) => ({ label: readStringField(item, "k") || "", text: readStringField(item, "t") || "" })).filter((item) => item.label && item.text),
    industries: readStringArray(objectText, "industries"), stats: readObjectArray(objectText, "stats").map((item) => readStringField(item, "v")).filter((value): value is string => Boolean(value)),
    tags: readStringArray(objectText, "tags"), badge: readStringField(objectText, "badge"), linkedinUrl: readStringField(objectText, "linkedin"),
    xUrl, xHandle: xUrl ? parseXHandle(xUrl) : null, source: { bundlePath, verified: true }
  };
  if (!profile.roleLine && !profile.bio) throw new Error(`The matched AGI Summit profile record for ${inputName} contains no usable description.`);
  if (!profile.highlights.length) throw new Error(`The matched AGI Summit profile record for ${inputName} contains no verified highlights.`);
  return profile;
}

async function findVerifiedHeadshot(inputName: string, profileKey: string, siteDirectory: string, extractionGuidePath: string, headshotManifestPath: string | null) {
  const nameTokens = inputName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  const candidates: Array<{ file: string; score: number; source: "name" | "guide" | "manifest" | "live" }> = walkFiles(siteDirectory).filter((file) => /\.(webp|png|jpe?g)$/i.test(file)).map((file) => {
    const base = normalizeProfileKey(path.basename(file).replace(/_KJhG(?=\.)/i, "").replace(/\.[^.]+$/, ""));
    let score = base.includes(profileKey) ? 160 : nameTokens.reduce((sum, token) => sum + (base.includes(token) ? 32 : 0), 0);
    if (/favicon|logo|hero|booth|screenshot|day[12]|background/i.test(path.basename(file))) score -= 100;
    return { file, score, source: "name" as const };
  }).filter((candidate) => candidate.score >= Math.max(60, nameTokens.length * 28)).sort((a, b) => b.score - a.score || a.file.length - b.file.length);
  if (!candidates.length) {
    const guide = fs.readFileSync(extractionGuidePath, "utf8");
    const guideMatch = new RegExp(`${escapeRegExp(inputName)}(?:['’]s)?\\s+headshot[\\s\\S]{0,700}?\\b([a-z0-9_-]+\\.(?:webp|png|jpe?g))`, "i").exec(guide);
    if (guideMatch) {
      const guideBase = guideMatch[1].replace(/_KJhG(?=\.)/i, "");
      const opaque = walkFiles(siteDirectory).find((file) => normalizeProfileKey(path.basename(file).replace(/_KJhG(?=\.)/i, "")) === normalizeProfileKey(guideBase));
      if (opaque) candidates.push({ file: opaque, score: 200, source: "guide" });
    }
  }
  if (!candidates.length && headshotManifestPath) {
    const manifestBaseName = verifiedHeadshotBasename(profileKey, headshotManifestPath);
    const manifestMatch = manifestBaseName ? matchDownloadedImage(siteDirectory, manifestBaseName) : null;
    if (manifestMatch) candidates.push({ file: manifestMatch, score: 220, source: "manifest" });
  }
  if (!candidates.length) {
    const liveBaseName = await resolveLiveImageBasename(inputName);
    const liveMatch = liveBaseName ? matchDownloadedImage(siteDirectory, liveBaseName) : null;
    if (liveMatch) candidates.push({ file: liveMatch, score: 210, source: "live" });
  }
  if (!candidates.length) throw new Error(`A verified headshot was not found for ${inputName}; opaque filenames require a live-page alt match or manual verification.`);
  if (candidates[1] && candidates[1].score === candidates[0].score && path.basename(candidates[1].file) !== path.basename(candidates[0].file)) throw new Error(`Multiple equally likely headshots were found for ${inputName}; manual verification is required.`);
  const selected = candidates[0].file;
  const metadata = await sharp(selected).metadata();
  if (!metadata.width || !metadata.height || !["webp", "png", "jpeg"].includes(metadata.format || "")) throw new Error(`The matched headshot for ${inputName} is not a decodable PNG, JPEG, or WebP image.`);
  const extension = metadata.format === "jpeg" ? ".jpg" : `.${metadata.format}`;
  const verificationMethod = candidates[0].source === "name"
    ? "name-based filename match plus decoded image, dimension, and visual validation"
    : candidates[0].source === "manifest"
      ? "locally cached live-page alt-to-src mapping plus decoded image, dimension, and visual validation"
      : "speaker-extraction guide or live-page alt-to-src mapping plus decoded image, dimension, and visual validation";
  return { path: selected, extension, mimeType: metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format}`, verificationMethod };
}

function matchDownloadedImage(siteDirectory: string, liveBaseName: string) {
  const normalized = normalizeProfileKey(liveBaseName.replace(/_KJhG(?=\.)/i, ""));
  return walkFiles(siteDirectory).find((file) => normalizeProfileKey(path.basename(file).replace(/_KJhG(?=\.)/i, "")) === normalized) || null;
}

function verifiedHeadshotBasename(profileKey: string, manifestPath: string) {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { speakers?: Array<{ profileKey?: unknown; imageBasename?: unknown }> };
    const match = parsed.speakers?.find((speaker) => speaker.profileKey === profileKey);
    return typeof match?.imageBasename === "string" && /\.(webp|png|jpe?g)$/i.test(match.imageBasename) ? path.basename(match.imageBasename) : null;
  } catch { return null; }
}

const PREFERRED_ORGANIZATION_OVERRIDES: Record<string, string> = {
  marcopavone: "NVIDIA"
};

const ORGANIZATION_ALIASES: Record<string, string[]> = {
  "Stanford University": ["Stanford"],
  "Carnegie Mellon": ["CMU", "Carnegie Mellon University"],
  "UC Berkeley": ["Berkeley", "University of California Berkeley"],
  "Google DeepMind": ["DeepMind"],
  "New Enterprise Associates": ["NEA"]
};

export function resolveSpeakerOrganizationBrand(profile: SpeakerProfile, bundlePath: string, siteDirectory: string): SpeakerOrganizationBrand {
  const registry = extractOrganizationBrandRegistry(bundlePath, siteDirectory);
  const override = PREFERRED_ORGANIZATION_OVERRIDES[profile.profileKey];
  const selected = override ? registry.find((entry) => normalizeProfileKey(entry.name) === normalizeProfileKey(override)) : rankOrganizationBrands(profile, registry)[0];
  if (selected) return selected;

  const inferredName = inferOrganizationName(profile);
  if (!inferredName) throw new Error(`A verified organization could not be resolved for ${profile.displayName}.`);
  return {
    name: inferredName,
    sourcePath: null,
    sourceFileName: null,
    verificationMethod: "organization name extracted from the verified speaker profile; typographic lockup rendered locally"
  };
}

function extractOrganizationBrandRegistry(bundlePath: string, siteDirectory: string) {
  const source = fs.readFileSync(bundlePath, "utf8");
  const entries = new Map<string, SpeakerOrganizationBrand>();
  const key = `(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\\w$]*))`;
  const localLogoPattern = new RegExp(`${key}\\s*:\\s*M\\(\\s*["']([^"']+\\.(?:svg|png|webp|jpe?g))["']`, "gi");
  for (const match of source.matchAll(localLogoPattern)) {
    const name = match[1] || match[2] || match[3];
    const sourcePath = matchDownloadedAsset(siteDirectory, match[4]);
    if (!name || !sourcePath || entries.has(normalizeProfileKey(name))) continue;
    entries.set(normalizeProfileKey(name), {
      name,
      sourcePath,
      sourceFileName: path.basename(sourcePath),
      verificationMethod: "organization and local logo resolved from the downloaded AGI Summit brand registry"
    });
  }
  const textLogoPattern = new RegExp(`${key}\\s*:\\s*\\{\\s*url\\s*:\\s*["']["']\\s*,\\s*text\\s*:\\s*["']([^"']+)["']`, "gi");
  for (const match of source.matchAll(textLogoPattern)) {
    const name = match[1] || match[2] || match[3];
    if (!name || entries.has(normalizeProfileKey(name))) continue;
    entries.set(normalizeProfileKey(name), {
      name,
      sourcePath: null,
      sourceFileName: null,
      fallbackText: match[4],
      verificationMethod: `organization and approved “${match[4]}” text lockup resolved from the downloaded AGI Summit brand registry`
    });
  }
  return Array.from(entries.values());
}

function rankOrganizationBrands(profile: SpeakerProfile, registry: SpeakerOrganizationBrand[]) {
  const fields = [
    { value: profile.roleLine || "", weight: 120 },
    { value: profile.subtitle || "", weight: 90 },
    ...profile.highlights.flatMap((highlight) => [{ value: highlight.label, weight: 60 }, { value: highlight.text, weight: 35 }]),
    { value: profile.bio || "", weight: 25 },
    { value: profile.badge || "", weight: 10 }
  ];
  return registry.map((brand) => {
    const terms = [brand.name, ...(ORGANIZATION_ALIASES[brand.name] || [])].map(normalizeSearchText).filter((term) => term.length >= 3);
    let score = 0;
    let roleIndex = Number.POSITIVE_INFINITY;
    for (const field of fields) {
      const haystack = normalizeSearchText(field.value);
      for (const term of terms) {
        const index = haystack.indexOf(term);
        if (index >= 0) {
          score += field.weight;
          if (field.weight === 120) roleIndex = Math.min(roleIndex, index);
        }
      }
    }
    return { brand, score, roleIndex };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.roleIndex - b.roleIndex || b.brand.name.length - a.brand.name.length).map((entry) => entry.brand);
}

function inferOrganizationName(profile: SpeakerProfile) {
  const subtitleCandidate = profile.subtitle?.split(/\s*[·|]\s*/).map((value) => value.trim()).filter(Boolean).at(-1);
  if (subtitleCandidate && /[A-Za-z]/.test(subtitleCandidate) && subtitleCandidate.length <= 60) return subtitleCandidate;
  const roleLine = stripMarkdown(profile.roleLine || "");
  const match = /\b(?:at|of|for)\s+([A-Z][A-Za-z0-9.&'’-]*(?:\s+(?:(?:of|the|for)\s+)?[A-Z][A-Za-z0-9.&'’-]*){0,4})/.exec(roleLine);
  return match?.[1]?.replace(/\s+(?:and|with)$/i, "").trim() || null;
}

function normalizeSearchText(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchDownloadedAsset(siteDirectory: string, liveBaseName: string) {
  const normalized = normalizeProfileKey(path.basename(liveBaseName).replace(/_KJhG(?=\.)/i, ""));
  return walkFiles(siteDirectory).find((file) => normalizeProfileKey(path.basename(file).replace(/_KJhG(?=\.)/i, "")) === normalized) || null;
}

function freezeCardCopy(profile: SpeakerProfile, organizationName: string) {
  const fallbackHighlights = stripMarkdown(profile.roleLine || profile.subtitle || profile.bio || "AGI Summit speaker")
    .split(/\s+—\s+|;\s+|\.\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const highlightCandidates = [
    ...profile.highlights.map((highlight) => `${stripMarkdown(highlight.label)} — ${stripMarkdown(highlight.text)}`),
    ...fallbackHighlights,
    ...profile.industries.map((topic) => `Focus — ${stripMarkdown(topic)}`),
    ...profile.tags.map((topic) => `Expertise — ${stripMarkdown(topic)}`),
    `Organization — ${organizationName}`
  ].map((value) => truncateAtWord(value, 64)).filter(Boolean);
  const highlightRows = Array.from(new Set(highlightCandidates)).slice(0, 3);
  const topics = Array.from(new Set([...profile.industries, ...profile.tags].map(stripMarkdown).filter(Boolean))).slice(0, 3);
  if (!topics.length && profile.badge) topics.push(stripMarkdown(profile.badge));
  const rightRole = truncateAtWord(stripMarkdown(profile.roleLine || profile.subtitle || profile.bio || `${organizationName} speaker`), 104);
  const about = truncateAtWord(stripMarkdown(profile.bio || profile.roleLine || profile.subtitle || rightRole), 128);
  return { name: profile.displayName, organizationName, highlightRows, about, rightRole, topicLine: topics.join(" • ") };
}

function exactCardText(frozen: ReturnType<typeof freezeCardCopy>, config: SpeakerSpotlightBatch["config"]) {
  return [
    "THE WORLD’S",
    "LARGEST",
    "AI SUMMIT",
    "FEATURED SPEAKER",
    ...frozen.highlightRows,
    "ABOUT",
    frozen.about,
    "AGI SUMMIT SF 2026",
    "SPEAKER SPOTLIGHT",
    frozen.name,
    frozen.rightRole,
    frozen.topicLine,
    config.eventDates,
    config.eventVenue,
    config.eventWebsite
  ].filter(Boolean);
}

function buildImagePrompt(profile: SpeakerProfile, frozen: ReturnType<typeof freezeCardCopy>, config: SpeakerSpotlightBatch["config"]) {
  const visibleText = exactCardText(frozen, config).map((value) => JSON.stringify(value)).join("\n");
  return `Use case: ads-marketing\nAsset type: final 2:3 portrait social-media speaker spotlight poster, exactly ${SPEAKER_SPOTLIGHT_IMAGE_SPEC.width} × ${SPEAKER_SPOTLIGHT_IMAGE_SPEC.height} pixels.\n\nPrimary request: personalize the supplied canonical Palace of Fine Arts speaker-spotlight poster for ${profile.displayName}. Treat Image 1 as the actual template/edit target, not merely loose inspiration. Preserve the fixed campaign design and replace only the example speaker portrait and speaker-specific copy.\n\nInput images:\n- Image 1 is the canonical Yuandong Tian Palace of Fine Arts template. Preserve its exact 2:3 composition: the white left panel and near-black right panel divided by the same diagonal; the Bay AI Circle logo; the AGI Summit logo and “WHERE AGI CONVERGES” tagline; the stacked “THE WORLD’S / LARGEST / AI SUMMIT” campaign headline; the top-right neon “AGI SUMMIT SF 2026 / SPEAKER SPOTLIGHT” badge; the blue-to-purple accents; the icon style; and, explicitly, the faded Palace of Fine Arts architecture behind the speaker. These fixed elements must remain in the same locations, scale, colors, and style.\n- Image 2 is the verified identity reference for ${profile.displayName}. Replace Yuandong Tian with only this person. Preserve the current speaker's recognizable identity, facial structure, skin tone, eyes, expression, hairstyle, wardrobe, and professional appearance faithfully. Use a clean chest-up or mid-torso cutout large on the right, matching the template crop.\n\nExact visible text, verbatim; every line below is required and authorized:\n${visibleText}\n\nPersonalized content mapping:\n- Keep FEATURED SPEAKER in its existing left-column position.\n- Replace the three example credential rows with these three personalized rows, in order: ${JSON.stringify(frozen.highlightRows)}. Use one purple line icon per row and thin gray separators exactly like Image 1.\n- Replace the ABOUT paragraph with: ${JSON.stringify(frozen.about)}.\n- Replace the large lower-right name with: ${JSON.stringify(frozen.name)}. Keep it uppercase, white, condensed, and on one line when possible; adapt size to prevent clipping.\n- Replace the first lower-right detail row with: ${JSON.stringify(frozen.rightRole)}.\n- Replace the second lower-right detail row with: ${JSON.stringify(frozen.topicLine)}.\n- Keep the configured date, venue, and website in the same footer positions: ${JSON.stringify(config.eventDates)}, ${JSON.stringify(config.eventVenue)}, ${JSON.stringify(config.eventWebsite)}.\n\nComposition and hierarchy: match Image 1 pixel-for-pixel in visual structure. The fixed logos and campaign headline dominate the upper-left. Personalized credentials and ABOUT copy occupy the lower-left. The faded Palace of Fine Arts remains clearly recognizable but subdued in purple/navy behind the portrait. The portrait occupies the center-right and overlaps the landmark without obscuring the neon badge. The speaker name and two icon-led detail rows sit across the lower-right over the dark panel. Maintain all safe margins and separator rules from the template.\n\nTypography and color: use the same tall condensed display typography, modern narrow sans-serif details, black/white contrast, cobalt-to-violet gradient, neon blue-violet border glow, purple line icons, deep navy-black background, and restrained architectural fade shown in Image 1.\n\nConstraints: exactly 2:3; preserve all fixed logos and fixed campaign copy from Image 1; Palace of Fine Arts must be visibly present behind the speaker; use only supplied speaker claims; accurate and legible text; current speaker identity only; no organization logo replacement; no Yuandong Tian face, name, plaid shirt, or speaker-specific facts; no invented affiliation, unsupported credential, extra slogan, ticket URL, social handle, watermark, QR code, duplicate copy, placeholder, or malformed text.`;
}

async function generateFirstImage(input: {
  result: SpeakerSpotlightResult; profile: SpeakerProfile; frozen: ReturnType<typeof freezeCardCopy>; imagePrompt: string;
  headshotPath: string; headshotMimeType: string; styleReferencePath: string; speakerDirectory: string; config: SpeakerSpotlightBatch["config"]; apiKey: string | null; priorRequestIds: string[]; reporter?: OperationReporter;
}) {
  const requestIds: string[] = [];
  input.reporter?.checkpoint();
  input.reporter?.stage("processing", `${input.profile.displayName} · generating image 1 of 1.`);
  const attemptPath = path.join(input.speakerDirectory, `${input.result.slug}-speaker-spotlight-attempt-1.png`);
  let imageRequestId: string | null = null;
  if (isDemoMode()) {
    await createDemoSpotlight(input.headshotPath, input.profile, input.frozen, input.styleReferencePath, input.config, attemptPath);
  } else {
    let generated: Awaited<ReturnType<typeof speakerSpotlightImageWithOpenAI>>;
    try {
      generated = await speakerSpotlightImageWithOpenAI(input.apiKey!, {
        headshotPath: input.headshotPath,
        headshotMimeType: input.headshotMimeType,
        styleReferencePath: input.styleReferencePath,
        prompt: input.imagePrompt
      }, input.reporter?.signal);
    } catch (error) {
      throw new SpeakerSpotlightPipelineFailure("image_edit", error);
    }
    writeC2paStrippedImage(attemptPath, generated.bytes);
    imageRequestId = generated.requestId;
    if (imageRequestId) requestIds.push(imageRequestId);
    updateSpeakerSpotlightResult(input.result.id, { requestIds: uniqueRequestIds([...input.priorRequestIds, ...requestIds]) });
  }

  stripC2paFromFile(attemptPath);

  try {
    await validateFirstImageOutput(attemptPath);
    await restoreFixedTemplateRegions(attemptPath, input.styleReferencePath);
    await validateFirstImageOutput(attemptPath);
  } catch (error) {
    throw new SpeakerSpotlightPipelineFailure("image_validation", error);
  }

  const imageFileName = `${input.result.slug}-speaker-spotlight.png`;
  const imagePath = path.join(input.speakerDirectory, imageFileName);
  fs.copyFileSync(attemptPath, imagePath);
  return { imagePath, imageFileName, imageAssetId: crypto.randomUUID(), requestIds, imageRequestId };
}

async function validateFirstImageOutput(imagePath: string) {
  const metadata = await sharp(imagePath).metadata();
  if (metadata.format !== "png" || metadata.width !== SPEAKER_SPOTLIGHT_IMAGE_SPEC.width || metadata.height !== SPEAKER_SPOTLIGHT_IMAGE_SPEC.height) {
    throw new Error(`The first generated image was ${metadata.width || "?"}×${metadata.height || "?"} ${metadata.format || "unknown"}, not ${SPEAKER_SPOTLIGHT_IMAGE_SPEC.width}×${SPEAKER_SPOTLIGHT_IMAGE_SPEC.height} PNG. No automatic image retry was started.`);
  }
}

function firstOutputValidationRecord(input: {
  headshotVerificationMethod: string;
  postFactsVerified: boolean;
  imageRequestId: string | null;
  issues?: string[];
  humanReviewApprovedAt?: string | null;
}): SpeakerSpotlightQa {
  const attemptResult: SpeakerSpotlightImageAttemptResult = {
    attempt: 1,
    imageRequestId: input.imageRequestId,
    qaRequestId: null,
    mechanicalChecksPassed: true,
    checks: null,
    approved: true,
    issues: []
  };
  return {
    profileVerified: true,
    headshotVerified: true,
    headshotVerificationMethod: input.headshotVerificationMethod,
    imageModel: isDemoMode() ? "demo-image-v1" : "gpt-image-2",
    imageSize: SPEAKER_SPOTLIGHT_IMAGE_SPEC.size,
    imageAspectRatio: SPEAKER_SPOTLIGHT_IMAGE_SPEC.aspectRatio,
    imageValidationMode: "mechanical_only",
    imageAttempts: 1,
    imageTextVerified: null,
    identityVerified: null,
    postFactsVerified: input.postFactsVerified,
    issues: input.issues || [],
    imageAttemptResults: [attemptResult],
    humanReviewApprovedAt: input.humanReviewApprovedAt || null
  };
}

function buildPostPrompt(profile: SpeakerProfile, config: SpeakerSpotlightBatch["config"], example: string) {
  return `Write one cross-platform AGI Summit 2026 Speaker Spotlight social-media post.\n\nThe examples below control only tone, pacing, section order, emoji and bullet style. Never reuse their facts, names, handles, organizations, or hashtags.\n<examples>\n${example}\n</examples>\n\nVerified speaker data:\n${JSON.stringify(profile, null, 2)}\n\nCampaign configuration:\n${JSON.stringify(config, null, 2)}\n\nUse only verified speaker facts. Start with a relevant emoji followed by "Speaker Spotlight: ${profile.displayName}". Include a short thematic hook, a factual introduction, three or four 🔹 bullets, a forward-looking closing grounded in the verified expertise, "Hear <first name> on stage at ${config.eventName}.", and the configured dates, venue, ticket URL, and discount copy verbatim. Use a verified X handle only if supplied. End with four or five relevant hashtags including #AGISummit. Never invent a title, credential, statistic, affiliation, handle, or session topic. In factualClaimsUsed, list every speaker-specific source string used in the post verbatim from the verified profile; do not list campaign values or general thematic prose.`;
}

async function generatePost(apiKey: string, prompt: string, signal?: AbortSignal) {
  const generated = await speakerPostWithOpenAI(apiKey, { prompt }, signal);
  return { post: generated.bundle.post, requestId: generated.requestId, warnings: generated.bundle.warnings, factualClaimsUsed: generated.bundle.factualClaimsUsed };
}

function validatePost(post: string, profile: SpeakerProfile, config: SpeakerSpotlightBatch["config"], factualClaimsUsed: string[]) {
  const required = [profile.displayName, config.eventDates, config.eventVenue, config.ticketUrl, config.discountCopy];
  const missing = required.filter((value) => !post.includes(value));
  if (missing.length) throw new Error(`The generated post failed validation because required verified text was missing: ${missing.join(", ")}.`);
  const bulletCount = (post.match(/^🔹/gm) || []).length;
  if (bulletCount < 3 || bulletCount > 4) throw new Error("The generated post must contain three or four verified highlight bullets.");
  for (const exampleName of ["Mercedes Bent", "Shaheen Lavie-Rouse", "Daniel Miessler"]) if (exampleName !== profile.displayName && post.includes(exampleName)) throw new Error("The generated post retained facts from an example speaker.");
  const verifiedCorpus = JSON.stringify(profile);
  const unsupported = factualClaimsUsed.filter((claim) => claim && !verifiedCorpus.includes(claim));
  if (unsupported.length) throw new Error(`The generated post cited unsupported speaker claims: ${unsupported.join("; ")}.`);
}

function demoPost(profile: SpeakerProfile, config: SpeakerSpotlightBatch["config"]) {
  const firstName = profile.displayName.split(/\s+/)[0];
  const bullets = profile.highlights.slice(0, 4).map((item) => `🔹 ${item.label} — ${item.text}`).join("\n");
  return `🎙️ Speaker Spotlight: ${profile.displayName}\n\nThe next wave of AI will be shaped by people turning deep expertise into work that matters.\n\n${profile.displayName} is ${stripMarkdown(profile.roleLine || profile.bio || "an AGI Summit speaker")}.\n\n${bullets}\n\n${profile.industries.slice(0, 3).join(", ")} are becoming central to how the AI ecosystem moves from possibility to practical impact.\n\nHear ${firstName} on stage at ${config.eventName}.\n\n📅 ${config.eventDates}\n📍 ${config.eventVenue}\n🎟 Tickets: ${config.ticketUrl}\n\n🏷️ ${config.discountCopy}\n\n#AGISummit #AI #ArtificialIntelligence #SanFrancisco`;
}

async function restoreFixedTemplateRegions(imagePath: string, styleReferencePath: string) {
  const referenceMetadata = await sharp(styleReferencePath).metadata();
  if (referenceMetadata.width !== SPEAKER_SPOTLIGHT_IMAGE_SPEC.width || referenceMetadata.height !== SPEAKER_SPOTLIGHT_IMAGE_SPEC.height) {
    throw new Error("The canonical Speaker Spotlight template must be exactly 1024×1536 before fixed branding can be restored.");
  }
  const fixedLeft = await sharp(styleReferencePath).extract({ left: 0, top: 0, width: 475, height: 780 }).png().toBuffer();
  const fixedBadge = await sharp(styleReferencePath).extract({ left: 585, top: 45, width: 405, height: 170 }).png().toBuffer();
  const temporaryPath = `${imagePath}.template.png`;
  await sharp(imagePath).composite([
    { input: fixedLeft, left: 0, top: 0 },
    { input: fixedBadge, left: 585, top: 45 }
  ]).png().toFile(temporaryPath);
  fs.renameSync(temporaryPath, imagePath);
}

async function createDemoSpotlight(headshotPath: string, _profile: SpeakerProfile, frozen: ReturnType<typeof freezeCardCopy>, styleReferencePath: string, config: SpeakerSpotlightBatch["config"], outputPath: string) {
  const portrait = await sharp(headshotPath)
    .resize(650, 1050, { fit: "contain", position: "bottom", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const palace = await sharp(styleReferencePath)
    .extract({ left: 470, top: 220, width: 554, height: 330 })
    .resize(650, 760, { fit: "cover" })
    .modulate({ brightness: 0.44, saturation: 0.45 })
    .tint("#211b4c")
    .blur(0.8)
    .png()
    .toBuffer();
  const nameSize = Math.max(58, Math.min(110, Math.floor(7600 / Math.max(frozen.name.length, 8))));
  const highlightRows = frozen.highlightRows.map((value, index) => {
    const y = 820 + index * 112;
    const lines = wrapText(value, 30, 2);
    return `<g><circle cx="78" cy="${y - 10}" r="22" fill="none" stroke="#5924df" stroke-width="3"/><circle cx="78" cy="${y - 10}" r="7" fill="none" stroke="#5924df" stroke-width="3"/><text x="132" y="${y - 12}" font-family="Arial,Helvetica,sans-serif" font-size="20" fill="#111">${escapeXml(lines[0] || "")}</text><text x="132" y="${y + 18}" font-family="Arial,Helvetica,sans-serif" font-size="20" fill="#111">${escapeXml(lines[1] || "")}</text><line x1="52" y1="${y + 52}" x2="344" y2="${y + 52}" stroke="#aaa" stroke-width="1"/></g>`;
  }).join("");
  const aboutLines = wrapText(frozen.about, 30, 3);
  const roleLines = wrapText(frozen.rightRole, 48, 2);
  const topicLines = wrapText(frozen.topicLine, 48, 2);
  const venueLines = wrapText(config.eventVenue, 26, 2);
  const baseSvg = `<svg width="${SPEAKER_SPOTLIGHT_IMAGE_SPEC.width}" height="${SPEAKER_SPOTLIGHT_IMAGE_SPEC.height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset=".64" stop-color="#030617" stop-opacity="0"/><stop offset="1" stop-color="#02040b" stop-opacity=".96"/></linearGradient></defs><rect width="1024" height="1536" fill="#020514"/><path d="M0 0H545L290 1536H0Z" fill="#fbfbfb"/><rect x="360" y="200" width="664" height="1050" fill="#08091b" opacity=".45"/><rect x="360" y="690" width="664" height="846" fill="url(#shade)"/></svg>`;
  const textOverlay = `<svg width="${SPEAKER_SPOTLIGHT_IMAGE_SPEC.width}" height="${SPEAKER_SPOTLIGHT_IMAGE_SPEC.height}" xmlns="http://www.w3.org/2000/svg">${highlightRows}<text x="52" y="1185" font-family="Arial Narrow,Arial,sans-serif" font-size="31" font-weight="800" fill="#5120da">ABOUT</text><text x="52" y="1228" font-family="Arial,Helvetica,sans-serif" font-size="20" fill="#111">${escapeXml(aboutLines[0] || "")}</text><text x="52" y="1257" font-family="Arial,Helvetica,sans-serif" font-size="20" fill="#111">${escapeXml(aboutLines[1] || "")}</text><text x="52" y="1286" font-family="Arial,Helvetica,sans-serif" font-size="20" fill="#111">${escapeXml(aboutLines[2] || "")}</text><line x1="52" y1="1320" x2="292" y2="1320" stroke="#aaa"/><rect x="52" y="1350" width="34" height="34" rx="5" fill="none" stroke="#5924df" stroke-width="3"/><text x="106" y="1377" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="700" fill="#111">${escapeXml(config.eventDates)}</text><circle cx="69" cy="1445" r="17" fill="none" stroke="#5924df" stroke-width="3"/><circle cx="69" cy="1445" r="5" fill="#5924df"/><text x="106" y="1438" font-family="Arial,Helvetica,sans-serif" font-size="19" fill="#111">${escapeXml(venueLines[0] || "")}</text><text x="106" y="1467" font-family="Arial,Helvetica,sans-serif" font-size="19" fill="#111">${escapeXml(venueLines[1] || "")}</text><text x="405" y="1242" font-family="Arial Narrow,Arial,sans-serif" font-size="${nameSize}" font-weight="900" letter-spacing="-3" fill="#fff">${escapeXml(frozen.name.toUpperCase())}</text><line x1="408" y1="1285" x2="476" y2="1285" stroke="#7821ff" stroke-width="3"/><circle cx="438" cy="1332" r="20" fill="none" stroke="#7821ff" stroke-width="3"/><text x="493" y="1327" font-family="Arial,Helvetica,sans-serif" font-size="22" fill="#fff">${escapeXml(roleLines[0] || "")}</text><text x="493" y="1358" font-family="Arial,Helvetica,sans-serif" font-size="22" fill="#fff">${escapeXml(roleLines[1] || "")}</text><line x1="404" y1="1380" x2="965" y2="1380" stroke="#777"/><rect x="418" y="1400" width="42" height="42" rx="7" fill="none" stroke="#7821ff" stroke-width="3"/><text x="493" y="1424" font-family="Arial,Helvetica,sans-serif" font-size="21" fill="#fff">${escapeXml(topicLines[0] || "")}</text><text x="493" y="1452" font-family="Arial,Helvetica,sans-serif" font-size="21" fill="#fff">${escapeXml(topicLines[1] || "")}</text><line x1="404" y1="1475" x2="965" y2="1475" stroke="#777"/><circle cx="438" cy="1505" r="20" fill="none" stroke="#7821ff" stroke-width="3"/><text x="493" y="1513" font-family="Arial,Helvetica,sans-serif" font-size="22" fill="#fff">${escapeXml(config.eventWebsite)}</text></svg>`;
  await sharp(Buffer.from(baseSvg)).composite([
    { input: palace, left: 374, top: 220, blend: "screen" },
    { input: portrait, left: 374, top: 300 },
    { input: Buffer.from(textOverlay), left: 0, top: 0 }
  ]).png().toFile(outputPath);
}

function writeManifest(batchId: string, batchRoot: string) {
  const batch = listSpeakerSpotlightBatches().find((item) => item.id === batchId);
  if (!batch) return;
  const manifest = {
    batch_id: batch.id, status: batch.status, requested_speakers: batch.speakerNames, created_at: batch.createdAt, completed_at: batch.completedAt,
    speakers: batch.results.map((result) => ({ input_name: result.inputName, normalized_profile_key: result.profileKey, status: result.status, output_paths: { headshot: result.headshotFileName, profile: result.profile ? `${result.slug}-profile.json` : null, image_prompt: result.imagePrompt ? `${result.slug}-image-prompt.md` : null, image: result.imageFileName, post: result.post ? `${result.slug}-post.md` : null, qa: result.qa ? `${result.slug}-qa.json` : null }, verification_results: result.qa, api_request_ids: result.requestIds, retry_count: result.retryCount, provider_error: result.providerError, error: result.error }))
  };
  fs.writeFileSync(path.join(batchRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function extractBalanced(source: string, start: number, open: string, close: string) {
  let depth = 0; let quote = ""; let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) { if (escaped) escaped = false; else if (character === "\\") escaped = true; else if (character === quote) quote = ""; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === open) depth += 1;
    if (character === close) { depth -= 1; if (depth === 0) return source.slice(start, index + 1); }
  }
  throw new Error("The downloaded speaker record is malformed or incomplete.");
}

function fieldValueStart(objectText: string, field: string) {
  const match = new RegExp(`(?:^|[,{}])\\s*${escapeRegExp(field)}\\s*:\\s*`).exec(objectText);
  return match ? match.index + match[0].length : -1;
}

function readStringField(objectText: string, field: string) {
  const start = fieldValueStart(objectText, field);
  if (start < 0 || !['"', "'"].includes(objectText[start])) return null;
  return readJsString(objectText, start).value;
}

function readStringArray(objectText: string, field: string) {
  const start = fieldValueStart(objectText, field);
  if (start < 0 || objectText[start] !== "[") return [];
  const text = extractBalanced(objectText, start, "[", "]");
  const values: string[] = [];
  for (let index = 1; index < text.length - 1;) {
    while (/[\s,]/.test(text[index] || "")) index += 1;
    if (text[index] === '"' || text[index] === "'") { const parsed = readJsString(text, index); values.push(parsed.value); index = parsed.end; } else index += 1;
  }
  return values;
}

function readObjectArray(objectText: string, field: string) {
  const start = fieldValueStart(objectText, field);
  if (start < 0 || objectText[start] !== "[") return [];
  const text = extractBalanced(objectText, start, "[", "]");
  const values: string[] = [];
  for (let index = 1; index < text.length - 1;) {
    if (text[index] === "{") { const value = extractBalanced(text, index, "{", "}"); values.push(value); index += value.length; } else index += 1;
  }
  return values;
}

function readJsString(source: string, start: number) {
  const quote = source[start]; let value = ""; let index = start + 1;
  for (; index < source.length; index += 1) {
    const character = source[index];
    if (character === quote) return { value, end: index + 1 };
    if (character !== "\\") { value += character; continue; }
    const next = source[++index];
    if (next === "n") value += "\n"; else if (next === "r") value += "\r"; else if (next === "t") value += "\t"; else if (next === "u") { const hex = source.slice(index + 1, index + 5); value += String.fromCharCode(Number.parseInt(hex, 16)); index += 4; } else value += next;
  }
  throw new Error("The downloaded speaker record contains an unterminated string.");
}

function walkFiles(directory: string) {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(candidate)); else if (entry.isFile()) files.push(candidate);
  }
  return files;
}

async function resolveLiveImageBasename(inputName: string) {
  try {
    const response = await fetch("https://agisummit.ai/", { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "MarketingHub/1.0 local speaker asset verifier" } });
    if (!response.ok) return null;
    const html = await response.text();
    for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
      const alt = attribute(tag, "alt");
      if (normalizeProfileKey(alt || "") !== normalizeProfileKey(inputName)) continue;
      const source = attribute(tag, "src") || attribute(tag, "data-src") || attribute(tag, "srcset")?.split(/[ ,]/)[0];
      if (source) return path.basename(new URL(source, "https://agisummit.ai/").pathname);
    }
  } catch { return null; }
  return null;
}

function attribute(tag: string, name: string) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag);
  return match?.[2]?.replace(/&quot;/g, '"').replace(/&amp;/g, "&") || null;
}

function parseXHandle(url: string) {
  try { const segment = new URL(url).pathname.split("/").filter(Boolean)[0]; return segment ? `@${segment}` : null; } catch { return null; }
}

function stripMarkdown(value: string) { return value.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim(); }
function truncateAtWord(value: string, limit: number) {
  if (value.length <= limit) return value;
  const shortened = value.slice(0, Math.max(1, limit - 1)).replace(/\s+\S*$/, "").trimEnd();
  return `${shortened || value.slice(0, limit - 1)}…`;
}
function wrapText(value: string, lineLength: number, maxLines: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  while (words.length && lines.length < maxLines) {
    let line = "";
    while (words.length && `${line}${line ? " " : ""}${words[0]}`.length <= lineLength) line += `${line ? " " : ""}${words.shift()}`;
    if (!line) line = words.shift() || "";
    if (lines.length === maxLines - 1 && words.length) line = truncateAtWord(`${line} ${words.join(" ")}`, lineLength);
    lines.push(line);
  }
  return lines;
}
function speakerSlug(value: string) { return safeFileName(value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()).replace(/\.[^.]+$/, "") || "speaker"; }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function snakeCaseQa(qa: SpeakerSpotlightQa) { return { profile_verified: qa.profileVerified, headshot_verified: qa.headshotVerified, headshot_verification_method: qa.headshotVerificationMethod, image_model: qa.imageModel, image_size: qa.imageSize, image_aspect_ratio: qa.imageAspectRatio, image_validation_mode: qa.imageValidationMode, image_attempts: qa.imageAttempts, image_text_verified: qa.imageTextVerified, identity_verified: qa.identityVerified, post_facts_verified: qa.postFactsVerified, issues: qa.issues, image_attempt_results: qa.imageAttemptResults, human_review_approved_at: qa.humanReviewApprovedAt }; }

async function mapWithConcurrency<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) { const current = items[index++]; await work(current); }
  }));
}
