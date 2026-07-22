import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { PLATFORM_CONFIG, MAX_FILES } from "@/lib/config";
import { dataDirectory, isDemoMode, isPathInsideDataDirectory } from "@/server/config";
import type { BrandAsset, Platform } from "@/lib/types";
import { addGeneratedAsset, brandAssetStoragePath, createBrandAsset, deleteBrandAsset, listBrandAssets, listContentCampaigns, listContextDocuments } from "@/server/db/repository";
import { escapeXml, safeFileName } from "@/server/security/validation";
import { assistantImageWithOpenAI, imageWithReferencesOpenAI } from "@/server/ai/openai-provider";
import { DEMO_FAILURE_TRIGGERS } from "@/server/ai/demo-provider";
import type { OperationReporter } from "@/server/operations/types";
import { stripC2pa, writeC2paStrippedImage } from "@/server/images/strip-c2pa";

export async function storeBrandAsset(input: { title: string; type: BrandAsset["type"]; fileName: string; mimeType: string; bytes: Buffer }) {
  purgeStaleAssistantAttachments();
  if (listContextDocuments().length + listBrandAssets().length >= MAX_FILES) throw new Error(`Marketing Hub allows at most ${MAX_FILES} combined context documents and brand assets.`);
  const metadata = await sharp(input.bytes, { limitInputPixels: 40_000_000 }).metadata();
  if (!metadata.width || !metadata.height || !["png", "jpeg", "webp"].includes(metadata.format || "")) throw new Error("The uploaded image could not be validated.");
  const pipeline = sharp(input.bytes, { limitInputPixels: 40_000_000 }).rotate();
  const normalizedBytes = metadata.format === "png"
    ? await pipeline.png().toBuffer()
    : metadata.format === "webp"
      ? await pipeline.webp({ quality: 95 }).toBuffer()
      : await pipeline.jpeg({ quality: 95 }).toBuffer();
  const normalizedMetadata = await sharp(normalizedBytes).metadata();
  const assetId = crypto.randomUUID();
  const extension = metadata.format === "jpeg" ? ".jpg" : `.${metadata.format}`;
  const mimeType = metadata.format === "png" ? "image/png" : metadata.format === "webp" ? "image/webp" : "image/jpeg";
  const fileName = `${assetId}-${safeFileName(path.basename(input.fileName, path.extname(input.fileName)))}${extension}`;
  const storagePath = path.join(dataDirectory(), "uploads", fileName);
  fs.writeFileSync(storagePath, normalizedBytes, { flag: "wx" });
  return createBrandAsset({
    title: input.title,
    type: input.type,
    fileName,
    storagePath,
    mimeType,
    width: normalizedMetadata.width || metadata.width,
    height: normalizedMetadata.height || metadata.height,
    sizeBytes: normalizedBytes.length,
    active: true
  });
}

function purgeStaleAssistantAttachments() {
  const cutoff = Date.now() - 60 * 60 * 1_000;
  for (const asset of listBrandAssets()) {
    if (asset.type === "assistant_attachment" && Date.parse(asset.createdAt) < cutoff) {
      try { deleteBrandAsset(asset.id); } catch { /* A stale temporary upload must not block the next valid upload. */ }
    }
  }
}

export interface CampaignGraphicInput {
  campaignId: string;
  platform: Platform;
  prompt: string;
  apiKey: string | null;
  references?: Array<{ assetId: string; mode: "subject" | "style" | "logo" }>;
  outputSpec?: { width: number; height: number; size: string; aspectRatio: string };
  quality?: "low" | "medium" | "high" | "auto";
}

export async function generateCampaignGraphic(input: CampaignGraphicInput, signal?: AbortSignal, reporter?: OperationReporter) {
  throwIfSignalAborted(signal);
  reporter?.stage("image_validating", "Checking the saved campaign brief, output size, and image references.");
  reporter?.checkpoint();
  const campaign = listContentCampaigns().find((item) => item.id === input.campaignId);
  if (!campaign) throw new Error("Content campaign not found.");
  if (!campaign.imageGenerationEnabled) throw new Error("Image generation is disabled for this content campaign.");
  const requestedReferences = input.references || [];
  const activeAssets = listBrandAssets().filter((asset) => asset.active);
  const references = requestedReferences.map((reference) => {
    const asset = activeAssets.find((candidate) => candidate.id === reference.assetId);
    if (!asset) throw new Error("A selected visual reference is unavailable or inactive.");
    const storagePath = brandAssetStoragePath(asset.id);
    if (!storagePath || !isPathInsideDataDirectory(storagePath) || !fs.existsSync(storagePath)) throw new Error(`The visual reference “${asset.title}” is unavailable.`);
    return { ...reference, asset, storagePath };
  });
  const preset = input.outputSpec || { ...PLATFORM_CONFIG[input.platform].image, size: `${PLATFORM_CONFIG[input.platform].image.width}x${PLATFORM_CONFIG[input.platform].image.height}`, aspectRatio: "platform preset" };
  const referenceInstruction = references.map((reference, index) => reference.mode === "subject"
    ? `Image ${index + 1} is the primary subject/content reference. Preserve the requested subject faithfully in the new composition.`
    : reference.mode === "logo"
      ? `Image ${index + 1} is the official logo. Reproduce this logo faithfully as part of the finished artwork; do not redesign, restyle, misspell, or substitute it.`
      : `Image ${index + 1} is the AGI Summit style reference. Use its visual language, palette, typography character, density, and editorial polish without copying example-specific people or claims.`).join("\n");
  const productionPrompt = `${input.prompt.trim()}\n\n${referenceInstruction ? `REFERENCE ROLES\n${referenceInstruction}\n\n` : ""}FINAL ARTWORK CONTRACT\nCreate the complete, finished campaign graphic at ${preset.size} (${preset.aspectRatio}) in one image. Render every requested word, typographic treatment, logo, background, subject, texture, and layout directly in the generated image. Do not leave blank areas for later overlays and do not describe a background-only result. Keep literal copy in quotes, spell names exactly, prioritize legibility and a clear hierarchy, and include no extra or invented words. Return one final image only.`;
  reporter?.stage("image_generating", isDemoMode() ? "Creating the deterministic full-artwork demo preview." : `GPT Image 2 is rendering the complete graphic${references.length ? ` from ${references.length} supplied reference${references.length === 1 ? "" : "s"}` : ""} in one request.`);
  reporter?.checkpoint();
  if (input.prompt.includes(DEMO_FAILURE_TRIGGERS.image)) throw new Error("Deterministic demo image-generation error. Saved campaign text was preserved.");
  let finalBytes: Buffer;
  if (isDemoMode()) {
    finalBytes = await demoFinishedGraphic(preset.width, preset.height, campaign.name);
  } else {
    if (!input.apiKey) throw new Error("Connect an OpenAI API key before generating a live campaign image.");
    finalBytes = stripC2pa(references.length
      ? await imageWithReferencesOpenAI(input.apiKey, {
          references: references.map((reference) => ({ filePath: reference.storagePath, mimeType: reference.asset.mimeType })),
          prompt: productionPrompt,
          size: preset.size,
          quality: input.quality || "high"
        }, signal)
      : await assistantImageWithOpenAI(input.apiKey, { prompt: productionPrompt, size: preset.size, quality: input.quality || "high" }, signal)).bytes;
  }

  throwIfSignalAborted(signal);
  const metadata = await sharp(finalBytes, { limitInputPixels: 40_000_000 }).metadata();
  if (!metadata.width || !metadata.height || metadata.format !== "png") throw new Error("GPT Image 2 returned an image that could not be saved as a PNG.");
  const now = new Date().toISOString();
  const assetDir = path.join(dataDirectory(), "generated", input.campaignId);
  fs.mkdirSync(assetDir, { recursive: true });
  const compositeId = crypto.randomUUID();
  const compositePath = path.join(assetDir, `${compositeId}-${input.platform}.png`);
  throwIfSignalAborted(signal);
  writeC2paStrippedImage(compositePath, finalBytes);
  reporter?.stage("image_saving", "Saving the first complete GPT Image 2 result without visual QA or replacement.");
  reporter?.checkpoint();
  const asset = addGeneratedAsset({
    id: compositeId, campaignId: input.campaignId, kind: "composite", fileName: path.basename(compositePath), storagePath: compositePath,
    mimeType: "image/png", width: metadata.width, height: metadata.height, prompt: productionPrompt,
    overlay: { platform: input.platform, generationMode: "gpt-image-2-full-artwork", oneShot: true, logoAssetId: references.find((reference) => reference.mode === "logo")?.asset.id || null, referenceAssetId: references.find((reference) => reference.mode === "style")?.asset.id || references[0]?.asset.id || null, referenceMode: references.find((reference) => reference.mode === "style")?.mode || references[0]?.mode || null, references: references.map((reference) => ({ assetId: reference.asset.id, mode: reference.mode })), aspectRatio: preset.aspectRatio, providerSize: preset.size },
    model: isDemoMode() ? "demo-image-v1" : "gpt-image-2", createdAt: now
  });
  return asset;
}

function throwIfSignalAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("The image request was canceled.", "AbortError");
}

async function demoFinishedGraphic(width: number, height: number, campaignName: string) {
  const safeTitle = escapeXml(campaignName.replace(/^Assistant\s*·\s*[^·]+\s*·\s*/i, "").slice(0, 72) || "AGI Summit");
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#071425"/><stop offset=".58" stop-color="#173a68"/><stop offset="1" stop-color="#b8864b"/></linearGradient><radialGradient id="r"><stop stop-color="#6fe0d0" stop-opacity=".9"/><stop offset="1" stop-color="#6fe0d0" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="78%" cy="28%" r="42%" fill="url(#r)"/><path d="M${width * .46} 0 L${width} ${height * .5} L${width * .64} ${height} L${width * .34} ${height * .58} Z" fill="#fff" opacity=".07"/><text x="${width * .08}" y="${height * .12}" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="${Math.round(Math.min(width, height) * .032)}" font-weight="700" letter-spacing="3">AGI SUMMIT</text><text x="${width * .08}" y="${height * .58}" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="${Math.round(Math.min(width, height) * .07)}" font-weight="700">${safeTitle}</text><text x="${width * .08}" y="${height * .68}" fill="#dce9ff" font-family="Arial,Helvetica,sans-serif" font-size="${Math.round(Math.min(width, height) * .032)}">One-shot full-artwork demo</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
