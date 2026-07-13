import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ContextDocument, Platform } from "@/lib/types";
import { MAX_CONTEXT_CHARS } from "@/lib/config";
import { isDemoMode, projectContextDirectory } from "@/server/config";
import { listContextDocuments, updateContextDocument, upsertImportedContextDocument } from "@/server/db/repository";

export type ContextWorkflow = "research" | "outreach" | "content" | "speaker_spotlight";

const STOP_WORDS = new Set(["about", "after", "again", "also", "and", "are", "assets", "before", "best", "create", "creating", "from", "guide", "into", "marketing", "more", "only", "project", "reference", "that", "the", "their", "then", "this", "through", "use", "using", "with", "workflow"]);

export function normalizeContextCategory(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "reference";
}

export function deriveContextMetadata(title: string, body: string, sourcePath: string | null = null) {
  const haystack = `${title}\n${sourcePath || ""}\n${body.slice(0, 12_000)}`.toLowerCase();
  const platforms = new Set<string>();
  if (/\b(x\s*\/\s*twitter|twitter|x platform|x post)\b/i.test(haystack) || /x_twitter/i.test(sourcePath || "")) platforms.add("x");
  if (/\blinkedin\b/i.test(haystack)) platforms.add("linkedin");
  if (/\binstagram\b/i.test(haystack)) platforms.add("instagram");
  const purposes = new Set<string>();
  let type = "reference";
  let sourceOfTruth = false;
  if (/agi summit information/i.test(haystack)) {
    type = "event_information";
    sourceOfTruth = true;
    purposes.add("research"); purposes.add("outreach"); purposes.add("content"); purposes.add("speaker_spotlight");
  } else if (/speaker spotlight creation guide/i.test(haystack)) {
    type = "workflow_guide"; purposes.add("speaker_spotlight");
  } else if (/speaker extraction guide/i.test(haystack)) {
    type = "workflow_guide"; purposes.add("speaker_spotlight");
  } else if (/speaker spotlight/i.test(haystack) && /example/i.test(haystack)) {
    type = "approved_example"; purposes.add("speaker_spotlight");
  } else if (platforms.size || /playbook|style guide|best practices/i.test(haystack)) {
    type = "platform_guidance"; purposes.add("content");
  } else if (/brand voice|tone of voice/i.test(haystack)) {
    type = "brand_voice"; purposes.add("outreach"); purposes.add("content");
  } else if (/target audience|who should attend/i.test(haystack)) {
    type = "target_audience"; purposes.add("research"); purposes.add("outreach"); purposes.add("content");
  } else if (/outreach|partner.share/i.test(haystack)) {
    type = "outreach_guidance"; purposes.add("outreach");
  }
  if (!purposes.size) {
    purposes.add("research"); purposes.add("outreach"); purposes.add("content");
  }
  const tags = Array.from(new Set(tokenize(`${title} ${headings(body)}`).filter((token) => !STOP_WORDS.has(token)))).slice(0, 24);
  if (/agi summit/i.test(haystack)) tags.unshift("agi", "summit");
  const summary = firstSummary(body) || title;
  return { type, sourceOfTruth, summary, tags: Array.from(new Set(tags)), platforms: Array.from(platforms), purposes: Array.from(purposes) };
}

export function ensureProjectContextImported() {
  if (isDemoMode()) { ensureContextMetadataBackfilled(); return []; }
  const directory = projectContextDirectory();
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return [];
  const imported: ContextDocument[] = [];
  const files = fs.readdirSync(directory).filter((name) => /\.(md|txt)$/i.test(name)).sort();
  for (const name of files) {
    const sourcePath = path.join(directory, name);
    const body = fs.readFileSync(sourcePath, "utf8");
    const contentHash = crypto.createHash("sha256").update(body).digest("hex");
    const title = name.replace(/\.(md|txt)$/i, "");
    const metadata = deriveContextMetadata(title, body, sourcePath);
    const document = upsertImportedContextDocument({
      title, body, ...metadata, active: true, notes: `Automatically imported from ${name}.`,
      origin: "project_asset", sourcePath, contentHash
    });
    if (document) imported.push(document);
  }
  ensureContextMetadataBackfilled();
  return imported;
}

export function ensureContextMetadataBackfilled() {
  for (const document of listContextDocuments()) {
    if (document.summary && document.tags.length && document.purposes.length) continue;
    const derived = deriveContextMetadata(document.title, document.body, document.sourcePath);
    updateContextDocument(document.id, {
      type: document.type === "other" ? derived.type : document.type,
      summary: derived.summary, tags: derived.tags, platforms: derived.platforms, purposes: derived.purposes,
      sourceOfTruth: document.sourceOfTruth || derived.sourceOfTruth
    });
  }
}

export function selectRelevantContext(input: {
  workflow: ContextWorkflow;
  query: string;
  platforms?: Platform[];
  manualIds?: string[];
  automatic?: boolean;
}) {
  ensureProjectContextImported();
  const documents = listContextDocuments().filter((document) => document.active && document.body.trim());
  const automatic = input.automatic !== false;
  if (!automatic) {
    const selected = documents.filter((document) => (input.manualIds || []).includes(document.id));
    if (!selected.length) throw new Error("Select at least one active context document or enable automatic context.");
    return selectionResult(selected, input.platforms || [], false, []);
  }
  const queryTokens = new Set(tokenize(`${input.workflow} ${input.query} ${(input.platforms || []).join(" ")}`));
  const scored = documents.map((document) => {
    let score = 0;
    if (document.sourceOfTruth) score += 100;
    if (document.purposes.includes(input.workflow)) score += 42;
    if (input.platforms?.some((platform) => document.platforms.includes(platform))) score += 55;
    if (document.type === "event_information" && input.workflow !== "speaker_spotlight") score += 35;
    if (document.type === "workflow_guide" && input.workflow !== "speaker_spotlight") score -= 80;
    if (document.type === "approved_example" && input.workflow !== "speaker_spotlight") score -= 45;
    const documentTokens = new Set([...document.tags, ...tokenize(`${document.title} ${document.summary}`)]);
    for (const token of queryTokens) if (documentTokens.has(token)) score += token.length > 6 ? 8 : 4;
    return { document, score };
  }).sort((a, b) => b.score - a.score || Number(b.document.sourceOfTruth) - Number(a.document.sourceOfTruth));

  const selected: ContextDocument[] = [];
  let size = 0;
  for (const item of scored) {
    if (item.score < 18 && selected.length) continue;
    if (size + item.document.body.length > MAX_CONTEXT_CHARS) continue;
    selected.push(item.document);
    size += item.document.body.length;
  }
  if (!selected.length && scored[0] && scored[0].document.body.length <= MAX_CONTEXT_CHARS) selected.push(scored[0].document);
  if (!selected.length) throw new Error("No active context fits within the context limit.");
  return selectionResult(selected, input.platforms || [], true, scored.map(({ document, score }) => ({ id: document.id, title: document.title, score })));
}

function selectionResult(documents: ContextDocument[], platforms: Platform[], automatic: boolean, ranking: Array<{ id: string; title: string; score: number }>) {
  const missingPlatformGuidance = platforms.filter((platform) => !documents.some((document) => document.platforms.includes(platform) && document.type === "platform_guidance"));
  return {
    documents,
    documentIds: documents.map((document) => document.id),
    automatic,
    ranking,
    missingPlatformGuidance,
    rationale: automatic ? `Automatically selected ${documents.length} relevant document${documents.length === 1 ? "" : "s"} from the active library.` : `Used ${documents.length} manually selected document${documents.length === 1 ? "" : "s"}.`
  };
}

function tokenize(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{3,}/g) || [];
}

function headings(body: string) {
  return body.split(/\r?\n/).filter((line) => /^#{1,4}\s/.test(line)).slice(0, 30).join(" ");
}

function firstSummary(body: string) {
  return body.split(/\n\s*\n/).map((part) => part.replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim()).find((part) => part.length >= 30)?.slice(0, 320) || "";
}
