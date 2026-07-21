import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { MAX_ASSET_BYTES } from "@/lib/config";
import type { SpeakerSpotlightTemplate, SpeakerSpotlightTemplateBlueprint, SpeakerSpotlightTemplateSnapshot } from "@/lib/types";
import { dataDirectory, isDemoMode, isPathInsideDataDirectory, projectContextDirectory } from "@/server/config";
import {
  createSpeakerSpotlightTemplate,
  deleteSpeakerSpotlightTemplateRecord,
  getSpeakerSpotlightTemplate,
  getWorkspaceSetting,
  listSpeakerSpotlightTemplates,
  selectSpeakerSpotlightTemplate,
  setWorkspaceSetting,
  speakerSpotlightTemplateStorage,
  updateSpeakerSpotlightTemplate
} from "@/server/db/repository";
import { speakerSpotlightTemplateWithOpenAI } from "@/server/ai/openai-provider";
import type { OperationReporter } from "@/server/operations/types";
import { safeFileName } from "@/server/security/validation";

const DEFAULT_TEMPLATE_SEED_KEY = "speaker_spotlight_default_template_seeded_v1";

export const SpeakerSpotlightTemplateCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  exampleSpeakerName: z.string().trim().max(160).optional().default(""),
  fixedGuidance: z.string().trim().min(10).max(3000),
  variableGuidance: z.string().trim().min(10).max(3000),
  captionGuidance: z.string().trim().max(2000).optional().default(""),
  additionalGuidance: z.string().trim().max(3000).optional().default("")
});

export const SpeakerSpotlightTemplateOperationSchema = z.object({ templateId: z.string().uuid() });
export const SpeakerSpotlightTemplateSelectionSchema = z.object({ templateId: z.string().uuid() });

export async function ensureDefaultSpeakerSpotlightTemplate() {
  if (getWorkspaceSetting(DEFAULT_TEMPLATE_SEED_KEY)) return listSpeakerSpotlightTemplates();
  const contextDirectory = projectContextDirectory();
  const sourcePath = fs.existsSync(contextDirectory)
    ? walkFiles(contextDirectory).find((candidate) => /speaker spotlight social media image reference v3\.(?:png|jpe?g|webp)$/i.test(path.basename(candidate)))
    : null;
  if (!sourcePath) return listSpeakerSpotlightTemplates();

  const bytes = fs.readFileSync(sourcePath);
  const stored = await persistTemplateImage(crypto.randomUUID(), path.basename(sourcePath), bytes);
  const now = new Date().toISOString();
  const selected = !listSpeakerSpotlightTemplates().some((template) => template.selected && template.status === "ready");
  createSpeakerSpotlightTemplate({
    id: stored.id,
    name: "Palace of Fine Arts",
    status: "ready",
    version: 1,
    selected,
    sourceType: "builtin",
    originalFileName: path.basename(sourcePath),
    mimeType: "image/png",
    width: stored.width,
    height: stored.height,
    aspectRatio: stored.aspectRatio,
    sizeBytes: stored.sizeBytes,
    exampleSpeakerName: "Yuandong Tian",
    fixedGuidance: "Keep the Bay AI Circle and AGI Summit logos, campaign headline, Palace of Fine Arts backdrop, diagonal split, neon event badge, colors, icons, and visual hierarchy.",
    variableGuidance: "Replace the example speaker portrait, name, role, topics, highlights, biography, dates, venue, and website with verified current-speaker and campaign data.",
    captionGuidance: "",
    additionalGuidance: "This is the canonical Palace of Fine Arts Speaker Spotlight design.",
    blueprint: palaceBlueprint(),
    model: "curated-migration",
    requestId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    storagePath: stored.storagePath,
    thumbnailPath: stored.thumbnailPath
  });
  setWorkspaceSetting(DEFAULT_TEMPLATE_SEED_KEY, stored.id);
  return listSpeakerSpotlightTemplates();
}

export async function createPendingSpeakerSpotlightTemplate(input: z.input<typeof SpeakerSpotlightTemplateCreateSchema> & { fileName: string; bytes: Buffer }) {
  const parsed = SpeakerSpotlightTemplateCreateSchema.parse(input);
  if (input.bytes.length > MAX_ASSET_BYTES) throw new Error(`Speaker Spotlight templates must be ${Math.round(MAX_ASSET_BYTES / 1_000_000)} MB or smaller.`);
  const id = crypto.randomUUID();
  const stored = await persistTemplateImage(id, input.fileName, input.bytes);
  const now = new Date().toISOString();
  const version = Math.max(0, ...listSpeakerSpotlightTemplates().filter((template) => template.name.trim().toLowerCase() === parsed.name.trim().toLowerCase()).map((template) => template.version)) + 1;
  return createSpeakerSpotlightTemplate({
    id,
    name: parsed.name,
    status: "analyzing",
    version,
    selected: false,
    sourceType: "user",
    originalFileName: path.basename(input.fileName),
    mimeType: "image/png",
    width: stored.width,
    height: stored.height,
    aspectRatio: stored.aspectRatio,
    sizeBytes: stored.sizeBytes,
    exampleSpeakerName: parsed.exampleSpeakerName || null,
    fixedGuidance: parsed.fixedGuidance,
    variableGuidance: parsed.variableGuidance,
    captionGuidance: parsed.captionGuidance,
    additionalGuidance: parsed.additionalGuidance,
    blueprint: null,
    model: null,
    requestId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    storagePath: stored.storagePath,
    thumbnailPath: stored.thumbnailPath
  });
}

export async function analyzeSpeakerSpotlightTemplate(templateId: string, apiKey: string | null, reporter?: OperationReporter) {
  const template = getSpeakerSpotlightTemplate(templateId);
  const storage = speakerSpotlightTemplateStorage(templateId);
  if (!template || !storage || !fs.existsSync(storage.storagePath)) throw new Error("The saved Speaker Spotlight template image is unavailable.");
  if (!isDemoMode() && !apiKey) throw new Error("Connect an OpenAI API key before creating a live Speaker Spotlight template.");
  updateSpeakerSpotlightTemplate(templateId, { status: "analyzing", error: null, completedAt: null });
  try {
    reporter?.stage("analyzing", "Reading the layout, typography, fixed branding, and speaker-specific regions.");
    reporter?.checkpoint();
    const analyzed = isDemoMode()
      ? { blueprint: demoBlueprint(template), requestId: null, model: "demo-template-analyzer-v1" }
      : await speakerSpotlightTemplateWithOpenAI(apiKey!, { template, imagePath: storage.storagePath }, reporter?.signal);
    reporter?.stage("writing", "Writing a reusable image-edit prompt and verified content-slot contract.");
    reporter?.checkpoint();
    const blueprint = normalizeBlueprint(analyzed.blueprint, template.exampleSpeakerName);
    reporter?.stage("saving", "Saving the versioned template, thumbnail, and prompt contract.");
    const shouldSelect = !listSpeakerSpotlightTemplates().some((item) => item.id !== templateId && item.status === "ready" && item.selected);
    const completedAt = new Date().toISOString();
    const ready = updateSpeakerSpotlightTemplate(templateId, {
      status: "ready",
      selected: shouldSelect,
      blueprint,
      model: analyzed.model,
      requestId: analyzed.requestId,
      error: null,
      completedAt
    });
    return ready;
  } catch (error) {
    updateSpeakerSpotlightTemplate(templateId, {
      status: "failed",
      error: error instanceof Error ? error.message : "Template analysis failed.",
      completedAt: new Date().toISOString()
    });
    throw error;
  }
}

export async function deleteSpeakerSpotlightTemplate(templateId: string) {
  const removed = deleteSpeakerSpotlightTemplateRecord(templateId);
  const directory = path.dirname(removed.storagePath);
  if (isPathInsideDataDirectory(directory)) fs.rmSync(directory, { recursive: true, force: true });
  return removed.template;
}

export async function selectTemplate(templateId: string) {
  await ensureDefaultSpeakerSpotlightTemplate();
  return selectSpeakerSpotlightTemplate(templateId);
}

export async function readySpeakerSpotlightTemplate(templateId?: string | null) {
  await ensureDefaultSpeakerSpotlightTemplate();
  const templates = listSpeakerSpotlightTemplates();
  const template = templateId ? templates.find((item) => item.id === templateId) : templates.find((item) => item.selected);
  if (!template || template.status !== "ready" || !template.blueprint) throw new Error("Choose a ready Speaker Spotlight template before creating a batch.");
  return template;
}

export function speakerSpotlightTemplateSnapshot(template: SpeakerSpotlightTemplate): SpeakerSpotlightTemplateSnapshot {
  if (!template.blueprint) throw new Error("The selected Speaker Spotlight template has no completed prompt contract.");
  return {
    templateId: template.id,
    name: template.name,
    version: template.version,
    width: template.width,
    height: template.height,
    aspectRatio: template.aspectRatio,
    captionGuidance: template.captionGuidance,
    blueprint: template.blueprint
  };
}

async function persistTemplateImage(id: string, fileName: string, bytes: Buffer) {
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height || !["png", "jpeg", "webp"].includes(metadata.format || "")) throw new Error("Upload a decodable PNG, JPEG, or WebP template image.");
  const ratio = metadata.width / metadata.height;
  if (ratio > 3 || ratio < 1 / 3) throw new Error("Speaker Spotlight templates cannot be wider or taller than a 3:1 aspect ratio.");
  const { width, height } = normalizedCanvas(metadata.width, metadata.height);
  const directory = path.join(dataDirectory(), "speaker_spotlight_templates", id);
  fs.mkdirSync(directory, { recursive: true });
  const storagePath = path.join(directory, `${safeFileName(path.basename(fileName, path.extname(fileName))) || "template"}-reference.png`);
  const thumbnailPath = path.join(directory, "thumbnail.webp");
  const normalized = await sharp(bytes).resize(width, height, { fit: "fill" }).png().toBuffer();
  fs.writeFileSync(storagePath, normalized, { flag: "wx" });
  await sharp(normalized).resize({ width: 360, height: 360, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toFile(thumbnailPath);
  return { id, storagePath, thumbnailPath, width, height, aspectRatio: aspectRatioLabel(width, height), sizeBytes: normalized.length };
}

function normalizedCanvas(sourceWidth: number, sourceHeight: number) {
  const ratio = sourceWidth / sourceHeight;
  if (ratio >= 0.85 && ratio <= 1.18) return { width: 1024, height: 1024 };
  if (ratio < 1) return { width: 1024, height: 1536 };
  return { width: 1536, height: 1024 };
}

function aspectRatioLabel(width: number, height: number) {
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function greatestCommonDivisor(left: number, right: number): number {
  return right === 0 ? left : greatestCommonDivisor(right, left % right);
}

function normalizeBlueprint(blueprint: SpeakerSpotlightTemplateBlueprint, exampleSpeakerName: string | null): SpeakerSpotlightTemplateBlueprint {
  const fields = Array.from(new Set(["speaker_name" as const, ...blueprint.contentFields]));
  const exampleNameKey = exampleSpeakerName?.trim().toLowerCase() || "";
  const fixedText = exampleNameKey ? blueprint.fixedText.filter((value) => value.trim().toLowerCase() !== exampleNameKey) : blueprint.fixedText;
  return { ...blueprint, schemaVersion: 1, fixedText, contentFields: fields };
}

function demoBlueprint(template: SpeakerSpotlightTemplate): SpeakerSpotlightTemplateBlueprint {
  return {
    schemaVersion: 1,
    summary: `Reusable Speaker Spotlight template based on ${template.name}.`,
    layoutDescription: `Follow the uploaded template's major panels, spacing, hierarchy, branding positions, portrait area, and text alignment as closely as possible.`,
    visualStyle: "Match the uploaded reference image's palette, typography character, graphic motifs, contrast, lighting, and level of polish.",
    portraitTreatment: "Replace the example person with the verified current speaker while matching the source portrait crop, scale, placement, lighting, and edge treatment.",
    fixedElements: [template.fixedGuidance],
    variableElements: [template.variableGuidance],
    fixedText: [],
    exampleContentToRemove: template.exampleSpeakerName ? [template.exampleSpeakerName, `all visual and textual details belonging to ${template.exampleSpeakerName}`] : ["all example-speaker identity and copy"],
    contentFields: ["speaker_name", "organization_name", "role_line", "topic_line", "highlight_1", "highlight_2", "highlight_3", "event_dates", "event_venue", "event_website"],
    generationInstructions: `Treat Image 1 as the actual edit target. Preserve its fixed campaign design and use Image 2 only for the current speaker's identity. Replace the example portrait and speaker-specific copy with the supplied verified values. ${template.additionalGuidance}`.trim()
  };
}

function palaceBlueprint(): SpeakerSpotlightTemplateBlueprint {
  return {
    schemaVersion: 1,
    summary: "Premium 2:3 AGI Summit Speaker Spotlight poster with a diagonal white information panel and dark Palace of Fine Arts portrait field.",
    layoutDescription: "A white left panel and near-black right panel are divided by a strong diagonal. Fixed summit branding and a stacked campaign headline dominate the upper left; three icon-led credentials and ABOUT copy occupy the lower left. A neon event badge sits upper right, the faded Palace of Fine Arts and speaker portrait fill center-right, and the speaker name plus two detail rows sit across the lower-right dark panel.",
    visualStyle: "Crisp premium technology-conference editorial poster with black/white contrast, cobalt-to-violet gradients, restrained neon glow, tall condensed display typography, narrow sans-serif details, purple line icons, thin gray dividers, and a deep navy architectural fade.",
    portraitTreatment: "Use a large clean chest-up or mid-torso speaker cutout on the center-right, preserving identity and professional appearance while overlapping the faded Palace backdrop without obscuring the neon badge.",
    fixedElements: ["Bay AI Circle logo", "AGI Summit logo and WHERE AGI CONVERGES tagline", "THE WORLD'S LARGEST AI SUMMIT headline", "top-right neon event badge", "diagonal split", "Palace of Fine Arts backdrop", "blue-violet palette and icon style"],
    variableElements: ["speaker portrait", "speaker name", "three credential rows", "ABOUT copy", "role line", "topic line", "dates", "venue", "website"],
    fixedText: ["THE WORLD’S", "LARGEST", "AI SUMMIT", "FEATURED SPEAKER", "ABOUT", "AGI SUMMIT SF 2026", "SPEAKER SPOTLIGHT"],
    exampleContentToRemove: ["Yuandong Tian", "Yuandong Tian's face and plaid shirt", "all Yuandong Tian credentials, biography, role, and topics"],
    contentFields: ["speaker_name", "role_line", "topic_line", "about", "highlight_1", "highlight_2", "highlight_3", "event_dates", "event_venue", "event_website"],
    generationInstructions: "Treat Image 1 as the actual Palace of Fine Arts template/edit target, not loose inspiration. Preserve the exact composition, fixed campaign hierarchy, logos, badge, architecture, colors, icons, typography character, and safe margins. Replace only the example portrait and speaker-specific copy. Keep the Palace visible but subdued behind the new speaker, adapt the condensed speaker-name size to avoid clipping, and retain the original locations and proportions of every section."
  };
}

function walkFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(candidate) : entry.isFile() ? [candidate] : [];
  });
}
