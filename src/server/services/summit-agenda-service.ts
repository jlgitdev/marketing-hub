import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { z } from "zod";
import agendaJson from "@/data/summit-agenda.json";
import { MAX_ASSET_BYTES, PROMPT_VERSIONS, SUMMIT_AGENDA_IMAGE_SPEC } from "@/lib/config";
import { buildSummitAgendaCaption } from "@/lib/summit-agenda-caption";
import type { SummitAgendaBatch, SummitAgendaData, SummitAgendaPerson, SummitAgendaProviderError, SummitAgendaResult, SummitAgendaSession } from "@/lib/types";
import { ProviderFailure, summitAgendaImageWithOpenAI } from "@/server/ai/openai-provider";
import { dataDirectory, isDemoMode } from "@/server/config";
import {
  createSummitAgendaBatch,
  getSummitAgendaData,
  listSummitAgendaBatches,
  saveSummitAgendaData,
  updateSummitAgendaBatch,
  updateSummitAgendaResult
} from "@/server/db/repository";
import { stripC2paFromFile, writeC2paStrippedImage } from "@/server/images/strip-c2pa";
import { OperationCanceledError, type OperationReporter } from "@/server/operations/types";
import { escapeXml, safeFileName, validateAssetUpload } from "@/server/security/validation";

const sourceAgenda = agendaJson as unknown as SummitAgendaData;
const FORMAT_VALUES = ["Keynote", "Fireside", "Panel", "Workshop", "Talk", "Break"] as const;
const photoTokenSchema = z.string().regex(/^(default|custom):[A-Za-z0-9._-]{1,160}$/).nullable();

const personSchema = z.object({
  id: z.string().trim().min(1).max(180),
  name: z.string().trim().min(1).max(160),
  role: z.string().trim().max(200).default(""),
  company: z.string().trim().max(160).default(""),
  moderator: z.boolean().default(false),
  photo: photoTokenSchema
});

export const SummitAgendaSessionUpdateSchema = z.object({
  sessionId: z.string().trim().min(1).max(240),
  title: z.string().trim().max(320),
  format: z.enum(FORMAT_VALUES),
  start: z.number().int().min(0).max(1439),
  end: z.number().int().min(1).max(1440),
  people: z.array(personSchema).max(10)
}).superRefine((value, context) => {
  if (value.end <= value.start) context.addIssue({ code: "custom", path: ["end"], message: "End time must be after start time." });
  if (value.end - value.start > 360) context.addIssue({ code: "custom", path: ["end"], message: "A session cannot be longer than six hours." });
  if (new Set(value.people.map((person) => person.id)).size !== value.people.length) context.addIssue({ code: "custom", path: ["people"], message: "People must have unique ids." });
  if (value.people.filter((person) => person.moderator).length > 1) context.addIssue({ code: "custom", path: ["people"], message: "Only one moderator can be selected." });
});

export const SummitAgendaGenerateSchema = z.object({
  sessionIds: z.array(z.string().trim().min(1).max(240)).min(1).max(20)
});

export const SummitAgendaResumeSchema = z.object({
  sourceBatchId: z.string().uuid(),
  resultIds: z.array(z.string().uuid()).min(1).max(20)
});

export const SummitAgendaOperationSchema = z.union([SummitAgendaGenerateSchema, SummitAgendaResumeSchema]);

export interface SummitAgendaExecution {
  batch: SummitAgendaBatch;
  retryInput: z.infer<typeof SummitAgendaResumeSchema> | null;
}

export function getSummitAgendaWorkspace() {
  return { agenda: getSummitAgendaData(sourceAgenda), batches: listSummitAgendaBatches() };
}

export function updateSummitAgendaSession(input: z.infer<typeof SummitAgendaSessionUpdateSchema>) {
  const agenda = getSummitAgendaData(sourceAgenda);
  const location = findSession(agenda, input.sessionId);
  if (!location) throw new Error("Agenda session not found.");
  const { session } = location;
  const next: SummitAgendaSession = {
    ...session,
    title: input.title,
    format: input.format,
    start: input.start,
    end: input.end,
    startLabel: formatClock(input.start),
    endLabel: formatClock(input.end),
    people: normalizeModerators(input.people)
  };
  location.day.sessions[location.index] = next;
  return saveSummitAgendaData(agenda);
}

export function resetSummitAgendaSession(sessionId: string) {
  const agenda = getSummitAgendaData(sourceAgenda);
  const location = findSession(agenda, sessionId);
  const source = findSession(sourceAgenda, sessionId);
  if (!location || !source) throw new Error("The source agenda session could not be restored.");
  location.day.sessions[location.index] = structuredClone(source.session);
  return saveSummitAgendaData(agenda);
}

export async function saveSummitAgendaPortrait(input: { sessionId: string; personId: string; file: File }) {
  const validation = validateAssetUpload(input.file);
  if (validation) throw new Error(validation);
  if (input.file.size > MAX_ASSET_BYTES) throw new Error("Portraits must be 8 MB or smaller.");
  const agenda = getSummitAgendaData(sourceAgenda);
  const location = findSession(agenda, input.sessionId);
  const person = location?.session.people.find((item) => item.id === input.personId);
  if (!location || !person) throw new Error("The selected agenda person could not be found.");
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height || !["png", "jpeg", "webp"].includes(metadata.format || "")) throw new Error("The portrait is not a valid PNG, JPEG, or WebP image.");
  if (metadata.width < 120 || metadata.height < 120) throw new Error("Portraits must be at least 120 × 120 pixels.");
  const extension = metadata.format === "jpeg" ? ".jpg" : `.${metadata.format}`;
  const fileName = `${crypto.randomUUID()}${extension}`;
  const destination = path.join(dataDirectory(), "summit_agenda", "custom_portraits", fileName);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
  person.photo = `custom:${fileName}`;
  return saveSummitAgendaData(agenda);
}

export function resolveSummitAgendaPortrait(token: string) {
  const parsed = photoTokenSchema.parse(token);
  if (!parsed) return null;
  const [scope, fileName] = parsed.split(":", 2);
  const base = scope === "default"
    ? path.join(process.cwd(), "public", "summit-agenda", "portraits")
    : path.join(dataDirectory(), "summit_agenda", "custom_portraits");
  const resolved = path.join(base, safeFileName(fileName));
  if (path.dirname(resolved) !== base || !fs.existsSync(resolved)) return null;
  return resolved;
}

export async function createSummitAgendaPosts(input: z.infer<typeof SummitAgendaOperationSchema>, apiKey: string | null, reporter?: OperationReporter): Promise<SummitAgendaExecution> {
  if (!isDemoMode() && !apiKey) throw new Error("Connect an OpenAI API key before generating live agenda posts.");
  let selected: SummitAgendaSession[];
  let sessionIds: string[];
  if ("sourceBatchId" in input) {
    const sourceBatch = listSummitAgendaBatches().find((batch) => batch.id === input.sourceBatchId);
    if (!sourceBatch) throw new Error("The preserved agenda batch could not be found.");
    const uniqueResultIds = [...new Set(input.resultIds)];
    const sourceResults = uniqueResultIds.map((resultId) => sourceBatch.results.find((result) => result.id === resultId) || null);
    const unavailable = uniqueResultIds.filter((_, index) => !sourceResults[index]);
    if (unavailable.length) throw new Error("One or more preserved agenda results could not be found.");
    if (sourceResults.some((result) => result?.status === "completed")) throw new Error("Completed agenda images cannot be regenerated through a recovery retry.");
    selected = (sourceResults as SummitAgendaResult[]).map((result) => structuredClone(result.session));
    sessionIds = selected.map((session) => session.id);
  } else {
    const agenda = getSummitAgendaData(sourceAgenda);
    sessionIds = [...new Set(input.sessionIds)];
    const sessions = sessionIds.map((sessionId) => findSession(agenda, sessionId)?.session || null);
    const missing = sessionIds.filter((_, index) => !sessions[index]);
    if (missing.length) throw new Error(`Agenda sessions not found: ${missing.join(", ")}.`);
    selected = sessions as SummitAgendaSession[];
  }
  for (const session of selected) validateGenerationReady(session);

  reporter?.stage("preparing", "Freezing the selected agenda records and checking every portrait.");
  const now = new Date().toISOString();
  const batchId = crypto.randomUUID();
  const results: SummitAgendaResult[] = selected.map((session, index) => ({
    id: crypto.randomUUID(), batchId, sessionId: session.id, session: structuredClone(session), status: "queued",
    imageAssetId: null, imageFileName: null,
    caption: buildSummitAgendaCaption(session, sourceAgenda.event),
    prompt: null, requestId: null, providerError: null, error: null,
    createdAt: new Date(Date.now() + index).toISOString(), updatedAt: now
  }));
  const batch: SummitAgendaBatch = {
    id: batchId, sessionIds, status: "running", model: isDemoMode() ? "demo-agenda-v1" : "gpt-image-2",
    promptVersion: PROMPT_VERSIONS.summitAgenda, provider: isDemoMode() ? "demo" : "openai",
    warnings: [], error: null, createdAt: now, completedAt: null, results
  };
  createSummitAgendaBatch(batch);
  const batchDirectory = path.join(dataDirectory(), "summit_agenda", "batches", batchId);
  fs.mkdirSync(batchDirectory, { recursive: true });

  let completed = 0;
  let processed = 0;
  const retryableResultIds: string[] = [];
  try {
    for (const result of results) {
      reporter?.checkpoint();
      reporter?.stage("processing", `${result.session.startLabel} · ${result.session.title}`);
      updateSummitAgendaResult(result.id, { status: "generating", providerError: null, error: null });
      try {
        const generated = await generateSessionImage(result.session, batchDirectory, apiKey, reporter);
        updateSummitAgendaResult(result.id, {
          status: "completed", imageAssetId: crypto.randomUUID(), imageFileName: generated.fileName,
          imageStoragePath: generated.filePath, prompt: generated.prompt, requestId: generated.requestId, providerError: null, error: null
        });
        completed += 1;
      } catch (error) {
        if (reporter?.signal.aborted || error instanceof OperationCanceledError) {
          updateSummitAgendaResult(result.id, { status: "canceled", providerError: null, error: "Canceled while this image was generating." });
          throw new OperationCanceledError();
        }
        const providerError = summitAgendaProviderError(error);
        if (providerError?.retryable) retryableResultIds.push(result.id);
        updateSummitAgendaResult(result.id, {
          status: "failed", requestId: providerError?.requestId || null, providerError,
          error: error instanceof Error ? error.message : "Image generation failed."
        });
      }
      processed += 1;
      reporter?.progress(processed, results.length, "posts", `${processed} of ${results.length} processed; ${completed} completed.`);
    }
    reporter?.stage("finalizing", "Saving the complete C2PA-stripped PNG canvases and the completed batch record.");
    const finalized = finalizeBatch(batchId);
    return {
      batch: finalized,
      retryInput: retryableResultIds.length ? { sourceBatchId: finalized.id, resultIds: retryableResultIds } : null
    };
  } catch (error) {
    const canceled = reporter?.signal.aborted || error instanceof OperationCanceledError;
    for (const unfinished of listSummitAgendaBatches().find((item) => item.id === batchId)?.results.filter((item) => item.status === "queued" || item.status === "generating") || []) {
      updateSummitAgendaResult(unfinished.id, {
        status: canceled ? "canceled" : "failed", providerError: null,
        error: canceled ? unfinished.status === "generating" ? "Canceled while this image was generating." : "Canceled before this image started." : "The batch stopped before this image completed."
      });
    }
    const finalized = finalizeBatch(batchId);
    if (canceled) {
      const resultIds = finalized.results.filter((result) => result.status === "canceled").map((result) => result.id);
      throw new OperationCanceledError({
        resultEntityType: "summit_agenda", resultEntityId: finalized.id, resultHref: `/summit-agenda?batch=${finalized.id}`,
        completedUnits: finalized.results.filter((result) => result.status === "completed").length,
        retryable: resultIds.length > 0,
        retryInput: resultIds.length ? { sourceBatchId: finalized.id, resultIds } : undefined
      });
    }
    throw error;
  }
}

function summitAgendaProviderError(error: unknown): SummitAgendaProviderError | null {
  if (!(error instanceof ProviderFailure)) return null;
  return {
    code: error.code, status: error.details.status, providerCode: error.details.providerCode,
    providerType: error.details.providerType, param: error.details.param, requestId: error.details.requestId,
    retryable: error.details.retryable, moderationStage: error.details.moderationStage,
    moderationCategories: error.details.moderationCategories
  };
}

function finalizeBatch(batchId: string) {
  const batch = listSummitAgendaBatches().find((item) => item.id === batchId);
  if (!batch) throw new Error("Live agenda post batch not found.");
  const completed = batch.results.filter((result) => result.status === "completed").length;
  const failures = batch.results.filter((result) => result.status === "failed");
  const status = completed === batch.results.length ? "completed" : completed > 0 ? "partially_completed" : "failed";
  const warnings = failures.map((result) => `${result.session.startLabel} ${result.session.title}: ${result.error || "Generation failed."}`);
  updateSummitAgendaBatch(batchId, {
    status,
    warnings,
    error: status === "completed" ? null : `${completed} of ${batch.results.length} agenda posts completed.`,
    completedAt: new Date().toISOString()
  });
  return listSummitAgendaBatches().find((item) => item.id === batchId)!;
}

async function generateSessionImage(session: SummitAgendaSession, batchDirectory: string, apiKey: string | null, reporter?: OperationReporter) {
  const portraitPaths = session.people.map((person) => {
    const filePath = person.photo ? resolveSummitAgendaPortrait(person.photo) : null;
    if (!filePath) throw new Error(`A portrait is missing for ${person.name}.`);
    return filePath;
  });
  const referenceKey = session.people.length === 1 ? "one" : session.people.length === 2 ? "two" : "many";
  const referencePath = path.join(process.cwd(), "public", sourceAgenda.references[referenceKey]);
  if (!fs.existsSync(referencePath)) throw new Error("The matching agenda design reference is missing.");
  const prompt = buildImagePrompt(session);
  const baseName = safeFileName(`${session.day}-${session.startLabel}-${session.title}`).replace(/\.[^.]+$/, "").slice(0, 90);
  const fileName = `${baseName || session.id}-live.png`;
  const filePath = path.join(batchDirectory, fileName);
  let requestId: string | null = null;

  if (isDemoMode()) {
    await createDemoAgendaImage(session, portraitPaths, filePath);
  } else {
    reporter?.checkpoint();
    const providerPortraits = await Promise.all(portraitPaths.map(async (portraitPath, index) => {
      const metadata = await sharp(portraitPath).metadata();
      if (metadata.format !== "svg") return portraitPath;
      const rasterPath = path.join(batchDirectory, `${baseName || session.id}-portrait-${index + 1}.png`);
      await sharp(portraitPath, { density: 300 }).resize(1200, 1200, { fit: "inside", withoutEnlargement: false }).png().toFile(rasterPath);
      return rasterPath;
    }));
    const images = [referencePath, ...providerPortraits];
    const generated = await summitAgendaImageWithOpenAI(apiKey!, {
      images: await Promise.all(images.map(async (imagePath) => ({ filePath: imagePath, mimeType: await imageMimeType(imagePath) }))),
      prompt
    }, reporter?.signal);
    requestId = generated.requestId;
    writeC2paStrippedImage(filePath, generated.bytes);
  }
  stripC2paFromFile(filePath);
  const metadata = await sharp(filePath).metadata();
  if (metadata.format !== "png" || !metadata.width || !metadata.height) {
    throw new Error("The generated live agenda image was not a decodable PNG.");
  }
  return { fileName, filePath, prompt, requestId };
}

function buildImagePrompt(session: SummitAgendaSession) {
  const time = formatTimeRange(session.start, session.end);
  const names = session.people.map((person) => person.name);
  const moderator = session.people.find((person) => person.moderator)?.name || null;
  const portraitMap = session.people.map((person, index) => `- Image ${index + 2}: the real portrait for ${JSON.stringify(person.name)}${person.moderator ? " (moderator)" : ""}.`).join("\n");
  return `Use case: ads-marketing\nAsset type: 3:4 portrait social-media graphic. Compose the artwork as a strict 3:4 poster within the provider's ${SUMMIT_AGENDA_IMAGE_SPEC.providerSize.replace("x", " × ")} canvas. Keep every face, logo, word, name, and footer comfortably inside the canvas with generous safe margins.\n\nCreate an AGI Summit LIVE session graphic using Image 1 as the primary visual reference. Match its polished deep navy/black space background, luminous cyan-purple-orange orbital lines, AGI SUMMIT logo treatment, crisp white typography, glowing orange LIVE marker, gradient session-format label, strong editorial hierarchy, and generous safe margins. Adapt the supplied reference layout to the exact number of people in this session. Do not copy any example person, example title, example time, or example name.\n\nInput portraits:\n${portraitMap}\nPreserve every supplied person's recognizable identity, face, skin tone, hair, and professional appearance. Show each person exactly once. Never merge faces or invent an extra person.\n\nExact visible copy, verbatim:\n- LIVE\n- ${JSON.stringify(session.format.toUpperCase())}\n- ${JSON.stringify(session.title)}\n- ${names.map((name) => JSON.stringify(name)).join("\n- ")}\n${moderator ? `- MODERATOR beneath ${JSON.stringify(moderator)}\n` : ""}- ${JSON.stringify(time)}\n- SAN FRANCISCO\n\nLayout: the composition is strictly 3:4. For one person, use the dramatic single-speaker composition from Image 1; for two people, use a balanced paired portrait composition; for three or more, use the framed portrait grid shown in the multi-person reference and give the moderator clear priority. The title must remain the dominant text after the AGI SUMMIT mark. Nothing important may be clipped.\n\nConstraints: accurate, legible spelling; strict 3:4 composition; no rewritten title; no changed time; no invented role, company, sponsor, handle, QR code, watermark, CTA, ticket copy, duplicate name, malformed logo, placeholder, or clipped content. Output one finished poster, not a mockup.`;
}

async function createDemoAgendaImage(session: SummitAgendaSession, portraits: string[], outputPath: string) {
  const width = SUMMIT_AGENDA_IMAGE_SPEC.width;
  const height = SUMMIT_AGENDA_IMAGE_SPEC.height;
  const many = session.people.length >= 3;
  const titleLines = wrapText(session.title, many ? 35 : 27, many ? 3 : 4);
  const titleSize = many ? 48 : session.people.length === 2 ? 58 : 66;
  const titleSvg = titleLines.map((line, index) => `<tspan x="540" dy="${index === 0 ? 0 : titleSize * 1.08}">${escapeXml(line)}</tspan>`).join("");
  const base = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="g1" cx="12%" cy="76%"><stop offset="0" stop-color="#064d77" stop-opacity=".72"/><stop offset="1" stop-color="#02040d" stop-opacity="0"/></radialGradient>
      <radialGradient id="g2" cx="92%" cy="57%"><stop offset="0" stop-color="#4d1682" stop-opacity=".62"/><stop offset="1" stop-color="#02040d" stop-opacity="0"/></radialGradient>
      <linearGradient id="logo" x1="0" x2="1"><stop stop-color="#55d9fb"/><stop offset="1" stop-color="#8170ff"/></linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="#02040d"/><rect width="${width}" height="${height}" fill="url(#g1)"/><rect width="${width}" height="${height}" fill="url(#g2)"/>
    <path d="M-40 835 C235 1100 720 820 1140 485" fill="none" stroke="#2f68ff" stroke-width="3" opacity=".75"/><path d="M165 230 C530 -10 920 40 685 307" fill="none" stroke="#e15ad6" stroke-width="2" opacity=".75"/>
    <circle cx="145" cy="890" r="10" fill="#3fcdf8"/><circle cx="788" cy="108" r="8" fill="#ff814a"/>
    <text x="540" y="145" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="118" letter-spacing="8" fill="url(#logo)">AGI</text>
    <text x="540" y="208" text-anchor="middle" font-family="Arial, sans-serif" font-size="44" letter-spacing="20" fill="#fff">SUMMIT</text>
    <circle cx="390" cy="272" r="10" fill="#ff7548"/><text x="416" y="286" font-family="Arial, sans-serif" font-size="34" font-weight="800" letter-spacing="5" fill="#ff9a6f">LIVE</text>
    <line x1="535" y1="249" x2="535" y2="296" stroke="#fff" opacity=".75"/><text x="566" y="286" font-family="Arial, sans-serif" font-size="34" font-weight="800" letter-spacing="5" fill="#9c7cff">${escapeXml(session.format.toUpperCase())}</text>
    <text x="540" y="365" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="${titleSize}" fill="#fff">${titleSvg}</text>
  </svg>`;
  const baseImage = sharp(Buffer.from(base)).png();
  const composites: OverlayOptions[] = [];
  const boxes = portraitBoxes(session.people.length);
  for (let index = 0; index < portraits.length; index += 1) {
    const box = boxes[index];
    const photo = await sharp(portraits[index]).resize(box.width, box.height, { fit: "cover", position: "attention" }).png().toBuffer();
    const frame = Buffer.from(`<svg width="${box.width}" height="${box.height}" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="${box.width - 4}" height="${box.height - 4}" rx="${many ? 22 : 36}" fill="none" stroke="#5bd7ff" stroke-width="4"/><rect x="7" y="7" width="${box.width - 14}" height="${box.height - 14}" rx="${many ? 18 : 31}" fill="none" stroke="#bd62ff" stroke-width="2" opacity=".8"/></svg>`);
    composites.push({ input: photo, left: box.left, top: box.top }, { input: frame, left: box.left, top: box.top });
  }
  const labels = session.people.map((person, index) => {
    const box = boxes[index];
    const y = box.top + box.height - 24;
    return `<rect x="${box.left + 10}" y="${y - 42}" width="${box.width - 20}" height="58" rx="14" fill="#030712" fill-opacity=".82"/><text x="${box.left + box.width / 2}" y="${y}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${many ? 25 : 32}" font-weight="800" fill="#fff">${escapeXml(person.name)}</text>${person.moderator ? `<text x="${box.left + box.width / 2}" y="${y + 28}" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" font-weight="700" letter-spacing="4" fill="#6fd8ff">MODERATOR</text>` : ""}`;
  }).join("");
  const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${labels}<line x1="120" y1="1332" x2="960" y2="1332" stroke="#6bdfff" opacity=".55"/><text x="540" y="1380" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="800" letter-spacing="5" fill="#fff">${escapeXml(formatTimeRange(session.start, session.end))}</text><text x="540" y="1420" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="9" fill="#8ba8ff">SAN FRANCISCO</text></svg>`);
  await baseImage.composite([...composites, { input: overlay, left: 0, top: 0 }]).png().toFile(outputPath);
}

function portraitBoxes(count: number) {
  if (count === 1) return [{ left: 395, top: 600, width: 635, height: 620 }];
  if (count === 2) return [{ left: 45, top: 620, width: 480, height: 570 }, { left: 555, top: 620, width: 480, height: 570 }];
  const cols = count >= 5 ? 3 : 2;
  const width = cols === 3 ? 300 : 390;
  const height = count >= 5 ? 260 : 300;
  const gap = cols === 3 ? 30 : 42;
  const rows = Math.ceil(count / cols);
  const totalWidth = cols * width + (cols - 1) * gap;
  const top = rows === 2 ? 610 : 540;
  return Array.from({ length: count }, (_, index) => ({ left: Math.round((1080 - totalWidth) / 2 + (index % cols) * (width + gap)), top: top + Math.floor(index / cols) * (height + 28), width, height }));
}

function wrapText(value: string, maxCharacters: number, maxLines: number) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || (current.length + 1 + word.length > maxCharacters && lines.length < maxLines)) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  if (lines.length > maxLines) return [...lines.slice(0, maxLines - 1), lines.slice(maxLines - 1).join(" ")];
  return lines;
}

function normalizeModerators(people: SummitAgendaPerson[]) {
  let seenModerator = false;
  return people.map((person) => {
    const moderator = person.moderator && !seenModerator;
    if (moderator) seenModerator = true;
    return { ...person, moderator };
  });
}

function validateGenerationReady(session: SummitAgendaSession) {
  if (!session.title.trim()) throw new Error(`${session.startLabel} on ${session.stageName} needs a talk title before generation.`);
  if (!session.people.length) throw new Error(`${session.startLabel} “${session.title}” needs at least one person before generation.`);
  for (const person of session.people) {
    if (!person.name.trim()) throw new Error(`${session.startLabel} “${session.title}” has a person without a name.`);
    if (!person.photo || !resolveSummitAgendaPortrait(person.photo)) throw new Error(`${session.startLabel} “${session.title}” needs a portrait for ${person.name}.`);
  }
}

function findSession(agenda: SummitAgendaData, sessionId: string) {
  for (const day of agenda.days) {
    const index = day.sessions.findIndex((session) => session.id === sessionId);
    if (index >= 0) return { day, index, session: day.sessions[index] };
  }
  return null;
}

function formatClock(minutes: number) {
  const hour = Math.floor(minutes / 60) % 24;
  return `${hour > 12 ? hour - 12 : hour === 0 ? 12 : hour}:${String(minutes % 60).padStart(2, "0")}`;
}

function formatTimeRange(start: number, end: number) {
  const meridiem = (value: number) => value < 720 ? "AM" : "PM";
  const startPeriod = meridiem(start);
  const endPeriod = meridiem(end);
  return startPeriod === endPeriod ? `${formatClock(start)}–${formatClock(end)} ${endPeriod}` : `${formatClock(start)} ${startPeriod}–${formatClock(end)} ${endPeriod}`;
}

async function imageMimeType(filePath: string) {
  const metadata = await sharp(filePath).metadata();
  return metadata.format === "jpeg" ? "image/jpeg" : metadata.format === "webp" ? "image/webp" : metadata.format === "svg" ? "image/svg+xml" : "image/png";
}
