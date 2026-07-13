import crypto from "node:crypto";
import { z } from "zod";
import { PLATFORM_CONFIG, PROMPT_VERSIONS } from "@/lib/config";
import { isDemoMode, MODELS } from "@/server/config";
import type { ContentCampaign, Platform, PlatformPost } from "@/lib/types";
import { DEMO_FAILURE_TRIGGERS, demoSocialBundle } from "@/server/ai/demo-provider";
import { socialWithOpenAI } from "@/server/ai/openai-provider";
import { createContentCampaign, listBrandAssets, listContentCampaigns, listContextDocuments, replacePlatformPost } from "@/server/db/repository";
import { assertContextSize, contextConflictWarnings } from "@/server/security/validation";
import { selectRelevantContext } from "./context-service";
import type { OperationReporter } from "@/server/operations/types";

export const ContentInputSchema = z.object({
  name: z.string().min(2).max(120),
  brief: z.string().min(10).max(3000),
  objective: z.string().min(2).max(500),
  audience: z.string().min(2).max(500),
  callToAction: z.string().min(2).max(500),
  requiredPhrases: z.string().max(500).default(""),
  prohibitedPhrases: z.string().max(500).default(""),
  headline: z.string().max(160).default(""),
  imageDirection: z.string().max(1000).default(""),
  imageGenerationEnabled: z.boolean().default(true),
  selectedBrandAssetId: z.string().uuid().nullable().default(null),
  contextDocumentIds: z.array(z.string().uuid()).default([]),
  contextMode: z.enum(["auto", "manual"]).default("auto"),
  platforms: z.array(z.enum(["x", "linkedin", "instagram"])).min(1)
});

export async function generateContentCampaign(input: z.input<typeof ContentInputSchema>, apiKey: string | null, signal?: AbortSignal, reporter?: OperationReporter) {
  reporter?.stage("selecting", "Selecting approved event facts, brand voice, and platform guidance.");
  reporter?.checkpoint();
  const parsed = ContentInputSchema.parse(input);
  const selection = selectRelevantContext({ workflow: "content", query: `${parsed.name} ${parsed.brief} ${parsed.objective} ${parsed.audience} ${parsed.imageDirection}`, platforms: parsed.platforms, manualIds: parsed.contextDocumentIds, automatic: parsed.contextMode === "auto" });
  const context = selection.documents;
  assertContextSize(context);
  if (parsed.selectedBrandAssetId && !listBrandAssets().some((asset) => asset.id === parsed.selectedBrandAssetId && asset.active)) throw new Error("The selected brand asset is unavailable or inactive.");
  const now = new Date().toISOString();
  const campaignId = crypto.randomUUID();
  const campaignBase = {
    id: campaignId, name: parsed.name, brief: parsed.brief, objective: parsed.objective, targetAudience: parsed.audience,
    callToAction: parsed.callToAction, requiredPhrases: parsed.requiredPhrases, prohibitedPhrases: parsed.prohibitedPhrases,
    headline: parsed.headline, imageDirection: parsed.imageDirection, imageGenerationEnabled: parsed.imageGenerationEnabled,
    selectedBrandAssetId: parsed.selectedBrandAssetId, contextDocumentIds: selection.documentIds, platforms: parsed.platforms as Platform[],
    model: isDemoMode() ? "demo-provider-v1" : MODELS.text, promptVersion: PROMPT_VERSIONS.content,
    provider: isDemoMode() ? "demo" as const : "openai" as const, createdAt: now, updatedAt: now
  };
  let providerResult: Awaited<ReturnType<typeof socialWithOpenAI>>;
  try {
    reporter?.stage("drafting", selection.missingPlatformGuidance.length ? `OpenAI is researching current guidance for ${selection.missingPlatformGuidance.map((platform) => PLATFORM_CONFIG[platform].label).join(", ")} and drafting the campaign.` : "OpenAI is drafting distinct platform copy from the selected local guidance.");
    reporter?.checkpoint();
    if (isDemoMode() && parsed.brief.includes(DEMO_FAILURE_TRIGGERS.provider)) throw new Error("Deterministic demo provider error: content generation could not be completed.");
    providerResult = isDemoMode() ? { bundle: demoSocialBundle(parsed.platforms), usage: null } : await socialWithOpenAI(requireKey(apiKey), { ...parsed, context, webGuidancePlatforms: selection.missingPlatformGuidance }, signal);
  } catch (error) {
    createContentCampaign({ ...campaignBase, status: "failed", usage: null, warnings: [], error: error instanceof Error ? error.message : "Content generation failed.", posts: [], assets: [] });
    throw error;
  }
  const bundle = providerResult.bundle;
  reporter?.stage("checking", "Checking platform limits, approved phrases, image copy, and style-guide coverage.");
  reporter?.checkpoint();
  const posts: PlatformPost[] = parsed.platforms.map((platform) => {
    const generated = bundle.posts.find((post) => post.platform === platform);
    if (!generated) throw new Error(`The provider did not return a ${platform} post.`);
    const warnings = [...generated.warnings];
    const hasSelectedGuide = context.some((document) => document.platforms.includes(platform) && (document.type === "platform_guidance" || document.type === `${platform}_style`));
    const usedWebResearch = !hasSelectedGuide && selection.missingPlatformGuidance.includes(platform) && !isDemoMode();
    if (usedWebResearch) warnings.push(`No relevant local ${PLATFORM_CONFIG[platform].label} guidance was available; current web research supplied platform best practices while local event context remained authoritative.`);
    else if (!hasSelectedGuide) warnings.push(`No active ${PLATFORM_CONFIG[platform].label} guidance was available; restrained fallback style was used.`);
    if (generated.text.length > PLATFORM_CONFIG[platform].characterLimit) warnings.push(`${PLATFORM_CONFIG[platform].label} copy exceeds the configured ${PLATFORM_CONFIG[platform].characterLimit}-character limit.`);
    return { id: crypto.randomUUID(), campaignId, ...generated, styleGuideStatus: hasSelectedGuide ? "selected_guide" as const : usedWebResearch ? "web_research" as const : "fallback" as const, warnings, reviewStatus: "unreviewed" as const, version: 1 };
  });
  const campaign: ContentCampaign = {
    ...campaignBase, status: "completed", usage: providerResult.usage, warnings: Array.from(new Set([...bundle.warnings, ...contextConflictWarnings(context)])), error: null, posts, assets: []
  };
  reporter?.stage("saving", "Saving editable platform drafts and campaign metadata locally.");
  reporter?.checkpoint();
  return createContentCampaign(campaign);
}

export async function regeneratePlatform(campaignId: string, platform: Platform, apiKey: string | null) {
  const result = await regeneratePlatforms(campaignId, [platform], apiKey);
  if (result.failures.length) throw new Error(result.failures[0].error);
  return result.posts[0];
}

export async function regeneratePlatforms(campaignId: string, platforms: Platform[], apiKey: string | null, signal?: AbortSignal, reporter?: OperationReporter) {
  const campaign = listContentCampaigns().find((item) => item.id === campaignId);
  if (!campaign) throw new Error("Content campaign not found.");
  const uniquePlatforms = Array.from(new Set(platforms));
  if (!uniquePlatforms.length) throw new Error("Choose at least one platform to regenerate.");
  reporter?.stage("loading", "Loading the saved campaign and currently active platform guidance.");
  reporter?.checkpoint();
  const context = listContextDocuments().filter((document) => campaign.contextDocumentIds.includes(document.id) && document.active);
  if (!context.length) throw new Error("The campaign has no active context documents. Re-enable context before regenerating content.");
  assertContextSize(context);
  const posts: PlatformPost[] = [];
  const failures: Array<{ platform: Platform; error: string }> = [];
  for (let index = 0; index < uniquePlatforms.length; index += 1) {
    const platform = uniquePlatforms[index];
    const post = campaign.posts.find((item) => item.platform === platform);
    if (!post) {
      failures.push({ platform, error: `${PLATFORM_CONFIG[platform].label} post not found.` });
      reporter?.progress(index + 1, uniquePlatforms.length, "platforms", `${PLATFORM_CONFIG[platform].label} could not be found`);
      continue;
    }
    try {
      reporter?.stage("drafting", `${PLATFORM_CONFIG[platform].label} · ${index + 1} of ${uniquePlatforms.length}`);
      reporter?.checkpoint();
      const missingPlatformGuidance = context.some((document) => document.platforms.includes(platform) && (document.type === "platform_guidance" || document.type === `${platform}_style`)) ? [] : [platform];
      const providerResult = isDemoMode() ? { bundle: demoSocialBundle([platform]), usage: null } : await socialWithOpenAI(requireKey(apiKey), {
        name: campaign.name, brief: campaign.brief, objective: campaign.objective, audience: campaign.targetAudience,
        callToAction: campaign.callToAction, requiredPhrases: campaign.requiredPhrases, prohibitedPhrases: campaign.prohibitedPhrases,
        headline: campaign.headline, imageDirection: campaign.imageDirection, platforms: [platform], context, webGuidancePlatforms: missingPlatformGuidance
      }, signal);
      reporter?.stage("checking", `Checking the regenerated ${PLATFORM_CONFIG[platform].label} draft.`);
      reporter?.checkpoint();
      const generated = providerResult.bundle.posts.find((item) => item.platform === platform);
      if (!generated) throw new Error("The provider did not return the requested platform post.");
      posts.push(replacePlatformPost(post.id, generated));
    } catch (error) {
      if (signal?.aborted) throw error;
      failures.push({ platform, error: error instanceof Error ? error.message : "Regeneration failed." });
    }
    reporter?.progress(index + 1, uniquePlatforms.length, "platforms", `${PLATFORM_CONFIG[platform].label} processed`);
  }
  reporter?.stage("saving", failures.length ? `Saved ${posts.length} updated draft${posts.length === 1 ? "" : "s"}; ${failures.length} platform${failures.length === 1 ? "" : "s"} need attention.` : "All regenerated platform drafts are saved locally.");
  reporter?.checkpoint();
  return { campaignId, posts, failures };
}

function requireKey(key: string | null) {
  if (!key) throw new Error("Connect an OpenAI API key before generating live social content.");
  return key;
}
