import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { PLATFORM_CONFIG, MAX_FILES } from "@/lib/config";
import { dataDirectory, isDemoMode, isPathInsideDataDirectory, MODELS } from "@/server/config";
import type { BrandAsset, Platform } from "@/lib/types";
import { addGeneratedAsset, brandAssetStoragePath, createBrandAsset, generatedAssetStoragePath, listBrandAssets, listContentCampaigns, listContextDocuments } from "@/server/db/repository";
import { escapeXml, safeFileName } from "@/server/security/validation";
import { imageWithOpenAI } from "@/server/ai/openai-provider";
import { DEMO_FAILURE_TRIGGERS } from "@/server/ai/demo-provider";
import type { OperationReporter } from "@/server/operations/types";
import { stripC2pa, writeC2paStrippedImage } from "@/server/images/strip-c2pa";

export async function storeBrandAsset(input: { title: string; type: BrandAsset["type"]; fileName: string; mimeType: string; bytes: Buffer }) {
  if (listContextDocuments().length + listBrandAssets().length >= MAX_FILES) throw new Error(`Marketing Hub allows at most ${MAX_FILES} combined context documents and brand assets.`);
  const metadata = await sharp(input.bytes).metadata();
  if (!metadata.width || !metadata.height || !["png", "jpeg", "webp"].includes(metadata.format || "")) throw new Error("The uploaded image could not be validated.");
  const assetId = crypto.randomUUID();
  const extension = metadata.format === "jpeg" ? ".jpg" : `.${metadata.format}`;
  const fileName = `${assetId}-${safeFileName(path.basename(input.fileName, path.extname(input.fileName)))}${extension}`;
  const storagePath = path.join(dataDirectory(), "uploads", fileName);
  fs.writeFileSync(storagePath, input.bytes, { flag: "wx" });
  return createBrandAsset({
    title: input.title,
    type: input.type,
    fileName,
    storagePath,
    mimeType: input.mimeType,
    width: metadata.width,
    height: metadata.height,
    sizeBytes: input.bytes.length,
    active: true
  });
}

export interface CampaignGraphicInput {
  campaignId: string;
  platform: Platform;
  prompt: string;
  headline: string;
  subheadline: string;
  footer: string;
  logoAssetId?: string | null;
  logoPlacement?: "top_left" | "top_right" | "bottom_left" | "bottom_right";
  apiKey: string | null;
  baseAssetId?: string | null;
}

export async function generateCampaignGraphic(input: CampaignGraphicInput, signal?: AbortSignal, reporter?: OperationReporter) {
  reporter?.stage("validating", "Checking the campaign, platform preset, prompt, and selected assets.");
  reporter?.checkpoint();
  const campaign = listContentCampaigns().find((item) => item.id === input.campaignId);
  if (!campaign) throw new Error("Content campaign not found.");
  if (!campaign.imageGenerationEnabled) throw new Error("Image generation is disabled for this content campaign.");
  if (input.logoAssetId && !listBrandAssets().some((asset) => asset.id === input.logoAssetId && asset.active)) throw new Error("The selected logo is unavailable or inactive.");
  const preset = PLATFORM_CONFIG[input.platform].image;
  let baseBytes: Buffer;
  let basePrompt = input.prompt;
  if (input.baseAssetId) {
    reporter?.stage("background", "Reusing the selected saved background; no image API request is needed.");
    reporter?.checkpoint();
    if (!campaign.assets.some((asset) => asset.id === input.baseAssetId && asset.kind === "background")) throw new Error("The selected background does not belong to this campaign.");
    const existingPath = generatedAssetStoragePath(input.baseAssetId);
    if (!existingPath || !isPathInsideDataDirectory(existingPath)) throw new Error("The selected background is unavailable.");
    baseBytes = fs.readFileSync(existingPath);
  } else if (isDemoMode()) {
    reporter?.stage("background", "Creating the deterministic text-free demo background.");
    reporter?.checkpoint();
    if (input.prompt.includes(DEMO_FAILURE_TRIGGERS.image)) throw new Error("Deterministic demo image-generation error. Saved campaign text was preserved.");
    baseBytes = await demoBackground(preset.width, preset.height);
    basePrompt = input.prompt || "Deterministic demo background";
  } else {
    if (!input.apiKey) throw new Error("Connect an OpenAI API key before generating a live campaign image.");
    const strictPrompt = `${input.prompt}\n\nCreate only a text-free campaign background. No words, lettering, numbers, logos, watermarks, signage, or pseudo-text. Preserve generous clean negative space for application-rendered typography.`;
    reporter?.stage("background", "OpenAI is creating a text-free campaign background. Exact copy will be rendered by Marketing Hub next.");
    reporter?.checkpoint();
    baseBytes = stripC2pa(await imageWithOpenAI(input.apiKey, strictPrompt, "1024x1024", signal)).bytes;
  }

  reporter?.stage("resizing", `Decoding and fitting the background to ${preset.width} × ${preset.height}.`);
  reporter?.checkpoint();
  const now = new Date().toISOString();
  const assetDir = path.join(dataDirectory(), "generated", input.campaignId);
  fs.mkdirSync(assetDir, { recursive: true });
  const baseAssetId = input.baseAssetId || crypto.randomUUID();
  if (!input.baseAssetId) {
    const basePath = path.join(assetDir, `${baseAssetId}-background.png`);
    writeC2paStrippedImage(basePath, await sharp(baseBytes).resize(preset.width, preset.height, { fit: "cover" }).png().toBuffer());
    addGeneratedAsset({ id: baseAssetId, campaignId: input.campaignId, kind: "background", fileName: path.basename(basePath), storagePath: basePath, mimeType: "image/png", width: preset.width, height: preset.height, prompt: basePrompt, overlay: {}, model: isDemoMode() ? "demo-image-v1" : MODELS.image, createdAt: now });
    baseBytes = fs.readFileSync(basePath);
  }

  const overlaySvg = buildOverlaySvg(preset.width, preset.height, input.headline, input.subheadline, input.footer);
  reporter?.stage("composing", "Rendering exact headline, supporting copy, call to action, and optional logo.");
  reporter?.checkpoint();
  const compositeId = crypto.randomUUID();
  const compositePath = path.join(assetDir, `${compositeId}-${input.platform}.png`);
  const layers: OverlayOptions[] = [{ input: Buffer.from(overlaySvg), top: 0, left: 0 }];
  if (input.logoAssetId) {
    const logoPath = brandAssetStoragePath(input.logoAssetId);
    if (logoPath && isPathInsideDataDirectory(logoPath)) {
      const logo = await sharp(logoPath).resize({ width: Math.round(preset.width * 0.15), height: Math.round(preset.height * 0.12), fit: "inside" }).png().toBuffer();
      const placement = input.logoPlacement || "top_right";
      const top = placement.startsWith("top") ? Math.round(preset.height * 0.08) : Math.round(preset.height * 0.8);
      const left = placement.endsWith("left") ? Math.round(preset.width * 0.08) : Math.round(preset.width * 0.78);
      layers.push({ input: logo, top, left });
    }
  }
  writeC2paStrippedImage(compositePath, await sharp(baseBytes).resize(preset.width, preset.height, { fit: "cover" }).composite(layers).png().toBuffer());
  reporter?.stage("saving", "Saving the finished PNG and reusable background locally.");
  reporter?.checkpoint();
  const asset = addGeneratedAsset({
    id: compositeId, campaignId: input.campaignId, kind: "composite", fileName: path.basename(compositePath), storagePath: compositePath,
    mimeType: "image/png", width: preset.width, height: preset.height, prompt: basePrompt,
    overlay: { platform: input.platform, headline: input.headline, subheadline: input.subheadline, footer: input.footer, logoAssetId: input.logoAssetId || null, logoPlacement: input.logoPlacement || "top_right", baseAssetId },
    model: isDemoMode() ? "demo-image-v1" : MODELS.image, createdAt: now
  });
  return asset;
}

export function buildOverlaySvg(width: number, height: number, headline: string, subheadline: string, footer: string) {
  const fontSize = Math.round(Math.min(width, height) * 0.072);
  const lines = wrapText(headline || "Campaign headline", 20).slice(0, 3);
  const subheadlineLines = wrapText(subheadline, 48).slice(0, 2);
  const footerLines = wrapText(footer, 58).slice(0, 2);
  const startY = Math.round(height * 0.43);
  const textLines = lines.map((line, index) => `<text x="${Math.round(width * 0.08)}" y="${startY + index * Math.round(fontSize * 1.08)}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${escapeXml(line)}</text>`).join("");
  const subheadlineText = subheadlineLines.map((line, index) => `<text x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.78) + index * Math.round(fontSize * 0.48)}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(fontSize * 0.43)}" font-weight="500" fill="#e5eef6">${escapeXml(line)}</text>`).join("");
  const footerText = footerLines.map((line, index) => `<text x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.88) + index * Math.round(fontSize * 0.34)}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(fontSize * 0.3)}" font-weight="600" fill="#63d6c6">${escapeXml(line)}</text>`).join("");
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#07111f" stop-opacity="0.9"/><stop offset="0.72" stop-color="#07111f" stop-opacity="0.2"/><stop offset="1" stop-color="#07111f" stop-opacity="0"/></linearGradient></defs>
    <rect width="${width}" height="${height}" fill="url(#shade)"/>
    <rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.38)}" width="${Math.round(width * 0.055)}" height="5" rx="2" fill="#63d6c6"/>
    ${textLines}
    ${subheadlineText}
    ${footerText}
  </svg>`;
}

export function wrapText(value: string, max: number) {
  const words = value.trim().split(/\s+/).filter(Boolean).flatMap((word) =>
    word.length <= max
      ? [word]
      : Array.from({ length: Math.ceil(word.length / max) }, (_, index) => word.slice(index * max, (index + 1) * max))
  );
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || `${current} ${word}`.length > max) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  return lines;
}

async function demoBackground(width: number, height: number) {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0c2340"/><stop offset="0.55" stop-color="#164e63"/><stop offset="1" stop-color="#d8b26e"/></linearGradient><radialGradient id="r"><stop stop-color="#63d6c6" stop-opacity="0.9"/><stop offset="1" stop-color="#63d6c6" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="78%" cy="30%" r="38%" fill="url(#r)"/><path d="M${width * 0.52} 0 L${width} ${height * 0.52} L${width * 0.66} ${height} L${width * 0.38} ${height * 0.58} Z" fill="#ffffff" opacity="0.08"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
