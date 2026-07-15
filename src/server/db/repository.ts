import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  BrandAsset,
  ContentCampaign,
  ContextDocument,
  GeneratedAsset,
  LeadQualification,
  LeadRecord,
  OutreachCampaign,
  OutreachRecipient,
  PlatformPost,
  ResearchRun,
  SpeakerSpotlightBatch,
  SpeakerSpotlightResult,
  SupportingSource,
  WorkspaceState
} from "@/lib/types";
import { MAX_FILES } from "@/lib/config";
import { dataDirectory, isDemoMode, isPathInsideDataDirectory } from "@/server/config";
import { ensureDataDirectories, getDatabase, withTransaction } from "./database";
import { canonicalLeadKey, qualifyLead } from "@/server/services/lead-qualification";

const id = () => crypto.randomUUID();
const json = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};
const bool = (value: unknown) => Boolean(value);

const EMPTY_SCORE_BREAKDOWN: LeadQualification["scoreBreakdown"] = {
  audienceFit: 0,
  revenuePotential: 0,
  distribution: 0,
  contactability: 0,
  localRelevance: 0,
  timing: 0,
  evidenceQuality: 0
};

const DEFAULT_QUALIFICATION_SIGNALS: Omit<LeadQualification, "scoreBreakdown"> = {
  audienceFit: "weak",
  buyingSignal: "none",
  distributionPotential: "none",
  localRelevance: "none",
  timingFit: "neutral",
  decisionMakerAccess: "unknown",
  audienceSizeLabel: null
};

function enumValue<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return typeof value === "string" && choices.includes(value as T) ? value as T : fallback;
}

function hydrateQualification(value: unknown): { qualification: LeadQualification; hasCompleteScore: boolean } {
  const stored = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawBreakdown = stored.scoreBreakdown && typeof stored.scoreBreakdown === "object" && !Array.isArray(stored.scoreBreakdown)
    ? stored.scoreBreakdown as Record<string, unknown>
    : {};
  const breakdownKeys = Object.keys(EMPTY_SCORE_BREAKDOWN) as Array<keyof LeadQualification["scoreBreakdown"]>;
  const hasCompleteScore = breakdownKeys.every((key) => typeof rawBreakdown[key] === "number" && Number.isFinite(rawBreakdown[key]));
  const scoreBreakdown = Object.fromEntries(breakdownKeys.map((key) => [key, hasCompleteScore ? rawBreakdown[key] : 0])) as unknown as LeadQualification["scoreBreakdown"];

  return {
    hasCompleteScore,
    qualification: {
      audienceFit: enumValue(stored.audienceFit, ["weak", "moderate", "strong", "exact"], DEFAULT_QUALIFICATION_SIGNALS.audienceFit),
      buyingSignal: enumValue(stored.buyingSignal, ["none", "weak", "moderate", "strong"], DEFAULT_QUALIFICATION_SIGNALS.buyingSignal),
      distributionPotential: enumValue(stored.distributionPotential, ["none", "limited", "moderate", "high"], DEFAULT_QUALIFICATION_SIGNALS.distributionPotential),
      localRelevance: enumValue(stored.localRelevance, ["none", "adjacent", "local"], DEFAULT_QUALIFICATION_SIGNALS.localRelevance),
      timingFit: enumValue(stored.timingFit, ["poor", "neutral", "good", "urgent"], DEFAULT_QUALIFICATION_SIGNALS.timingFit),
      decisionMakerAccess: enumValue(stored.decisionMakerAccess, ["unknown", "influencer", "decision_maker"], DEFAULT_QUALIFICATION_SIGNALS.decisionMakerAccess),
      audienceSizeLabel: typeof stored.audienceSizeLabel === "string" ? stored.audienceSizeLabel : null,
      scoreBreakdown
    }
  };
}

function contextFromRow(row: Record<string, unknown>): ContextDocument {
  return {
    id: String(row.id), title: String(row.title), type: row.type as ContextDocument["type"], body: String(row.body),
    active: bool(row.active), sourceOfTruth: bool(row.source_of_truth), notes: String(row.notes || ""),
    summary: String(row.summary || ""), tags: json(String(row.tags || "[]"), []),
    platforms: json(String(row.platforms || "[]"), []), purposes: json(String(row.purposes || "[]"), []),
    origin: (row.origin || "user") as ContextDocument["origin"], sourcePath: row.source_path ? String(row.source_path) : null,
    contentHash: row.content_hash ? String(row.content_hash) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function brandAssetFromRow(row: Record<string, unknown>): BrandAsset {
  return {
    id: String(row.id), title: String(row.title), type: row.type as BrandAsset["type"], fileName: String(row.file_name),
    mimeType: String(row.mime_type), width: Number(row.width), height: Number(row.height), sizeBytes: Number(row.size_bytes),
    active: bool(row.active), createdAt: String(row.created_at)
  };
}

function sourceFromRow(row: Record<string, unknown>): SupportingSource {
  return {
    id: String(row.id), title: String(row.title), url: String(row.url), sourceType: row.source_type as SupportingSource["sourceType"],
    claim: String(row.claim), citationMetadata: json(String(row.citation_metadata || "{}"), {}), accessedAt: String(row.accessed_at)
  };
}

function leadFromRow(row: Record<string, unknown>, sources: SupportingSource[]): LeadRecord {
  const hydratedQualification = hydrateQualification(json<unknown>(String(row.qualification || "{}"), null));
  const lead: LeadRecord = {
    id: String(row.id), researchRunId: String(row.research_run_id), opportunityClass: row.opportunity_class as LeadRecord["opportunityClass"],
    organizationName: String(row.organization_name), organizationType: String(row.organization_type),
    organizationWebsite: row.organization_website ? String(row.organization_website) : null,
    organizationDomain: row.organization_domain ? String(row.organization_domain) : null,
    city: String(row.city), region: String(row.region), eventName: row.event_name ? String(row.event_name) : null,
    eventUrl: row.event_url ? String(row.event_url) : null, eventStartDate: row.event_start_date ? String(row.event_start_date) : null,
    eventEndDate: row.event_end_date ? String(row.event_end_date) : null, eventOrganizer: row.event_organizer ? String(row.event_organizer) : null,
    contactName: row.contact_name ? String(row.contact_name) : null, contactRole: row.contact_role ? String(row.contact_role) : null,
    contactEmail: row.contact_email ? String(row.contact_email) : null, emailCategory: row.email_category as LeadRecord["emailCategory"],
    emailSourceUrl: row.email_source_url ? String(row.email_source_url) : null,
    contactPageUrl: row.contact_page_url ? String(row.contact_page_url) : null,
    recommendedAction: String(row.recommended_action), fitExplanation: String(row.fit_explanation), evidenceSummary: String(row.evidence_summary),
    targetSegment: (row.target_segment || "general_technology") as LeadRecord["targetSegment"],
    salesMotion: (row.sales_motion || "partner_distribution") as LeadRecord["salesMotion"],
    priorityScore: Number(row.priority_score || 0), priorityTier: (row.priority_tier || "nurture") as LeadRecord["priorityTier"],
    qualification: hydratedQualification.qualification,
    outreachAngle: String(row.outreach_angle || ""), nextBestAction: String(row.next_best_action || ""),
    canonicalKey: String(row.canonical_key || ""), lastVerifiedAt: String(row.last_verified_at || row.researched_at),
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
    confidence: row.confidence as LeadRecord["confidence"], verificationStatus: row.verification_status as LeadRecord["verificationStatus"],
    warnings: json(String(row.warnings || "[]"), []), researchedAt: String(row.researched_at),
    reviewStatus: row.review_status as LeadRecord["reviewStatus"], selected: bool(row.selected),
    userEdits: json(String(row.user_edits || "{}"), {}), sources
  };
  if (!lead.canonicalKey) lead.canonicalKey = canonicalLeadKey(lead);
  if (!hydratedQualification.hasCompleteScore) {
    const { scoreBreakdown: _scoreBreakdown, ...signals } = hydratedQualification.qualification;
    void _scoreBreakdown;
    Object.assign(lead, qualifyLead(lead, signals));
  }
  return lead;
}

function runFromRow(row: Record<string, unknown>): ResearchRun {
  return {
    id: String(row.id), name: String(row.name), objective: String(row.objective), region: String(row.region), status: row.status as ResearchRun["status"],
    requestedCount: Number(row.requested_count), resultCount: Number(row.result_count), contextDocumentIds: json(String(row.context_document_ids), []),
    settings: json(String(row.settings), {}), model: String(row.model), promptVersion: String(row.prompt_version), provider: row.provider as ResearchRun["provider"],
    usage: row.usage ? json(String(row.usage), {}) : null, warnings: json(String(row.warnings), []), error: row.error ? String(row.error) : null,
    rawOutput: row.raw_output ? String(row.raw_output) : null, startedAt: String(row.started_at), completedAt: row.completed_at ? String(row.completed_at) : null
  };
}

function postFromRow(row: Record<string, unknown>): PlatformPost {
  return {
    id: String(row.id), campaignId: String(row.campaign_id), platform: row.platform as PlatformPost["platform"], text: String(row.text),
    hook: String(row.hook), callToAction: String(row.call_to_action), hashtags: String(row.hashtags), imageHeadline: String(row.image_headline),
    imageSubheadline: String(row.image_subheadline), imageAltText: String(row.image_alt_text), imagePrompt: String(row.image_prompt),
    warnings: json(String(row.warnings), []), styleGuideStatus: row.style_guide_status as PlatformPost["styleGuideStatus"],
    reviewStatus: row.review_status as PlatformPost["reviewStatus"], version: Number(row.version)
  };
}

function generatedFromRow(row: Record<string, unknown>): GeneratedAsset {
  return {
    id: String(row.id), campaignId: String(row.campaign_id), kind: row.kind as GeneratedAsset["kind"], fileName: String(row.file_name),
    mimeType: String(row.mime_type), width: Number(row.width), height: Number(row.height), prompt: String(row.prompt),
    overlay: json(String(row.overlay), {}), model: String(row.model), createdAt: String(row.created_at)
  };
}

export function listContextDocuments() {
  return (getDatabase().prepare("SELECT * FROM context_documents ORDER BY source_of_truth DESC, updated_at DESC").all() as Array<Record<string, unknown>>).map(contextFromRow);
}

export function createContextDocument(input: Omit<ContextDocument, "id" | "createdAt" | "updatedAt">) {
  const db = getDatabase();
  if (listContextDocuments().length + listBrandAssets().length >= MAX_FILES) throw new Error(`Marketing Hub allows at most ${MAX_FILES} combined context documents and brand assets.`);
  const now = new Date().toISOString();
  const document: ContextDocument = { ...input, id: id(), createdAt: now, updatedAt: now };
  if (document.sourceOfTruth) db.prepare("UPDATE context_documents SET source_of_truth = 0 WHERE type = ?").run(document.type);
  db.prepare(`INSERT INTO context_documents(id,title,type,body,active,source_of_truth,notes,summary,tags,platforms,purposes,origin,source_path,content_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(document.id, document.title, document.type, document.body, Number(document.active), Number(document.sourceOfTruth), document.notes, document.summary, JSON.stringify(document.tags), JSON.stringify(document.platforms), JSON.stringify(document.purposes), document.origin, document.sourcePath, document.contentHash, now, now);
  addActivity("context_created", `Added ${document.title}`, "Context Library", document.id);
  return document;
}

export function updateContextDocument(documentId: string, patch: Partial<Pick<ContextDocument, "title" | "type" | "body" | "active" | "sourceOfTruth" | "notes" | "summary" | "tags" | "platforms" | "purposes" | "contentHash">>) {
  const current = listContextDocuments().find((document) => document.id === documentId);
  if (!current) throw new Error("Context document not found.");
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  const db = getDatabase();
  if (next.sourceOfTruth) db.prepare("UPDATE context_documents SET source_of_truth = 0 WHERE type = ? AND id <> ?").run(next.type, next.id);
  db.prepare(`UPDATE context_documents SET title=?,type=?,body=?,active=?,source_of_truth=?,notes=?,summary=?,tags=?,platforms=?,purposes=?,content_hash=?,updated_at=? WHERE id=?`)
    .run(next.title, next.type, next.body, Number(next.active), Number(next.sourceOfTruth), next.notes, next.summary, JSON.stringify(next.tags), JSON.stringify(next.platforms), JSON.stringify(next.purposes), next.contentHash, next.updatedAt, next.id);
  return next;
}

export function deleteContextDocument(documentId: string) {
  const db = getDatabase();
  const document = listContextDocuments().find((item) => item.id === documentId);
  if (document?.sourcePath) db.prepare("UPDATE context_asset_imports SET deleted=1 WHERE source_path=?").run(document.sourcePath);
  db.prepare("DELETE FROM context_documents WHERE id = ?").run(documentId);
}

export function upsertImportedContextDocument(input: Omit<ContextDocument, "id" | "createdAt" | "updatedAt">) {
  if (!input.sourcePath || !input.contentHash) throw new Error("Imported context needs a source path and content hash.");
  const db = getDatabase();
  const tracked = db.prepare("SELECT * FROM context_asset_imports WHERE source_path=?").get(input.sourcePath) as Record<string, unknown> | undefined;
  if (tracked && bool(tracked.deleted)) return null;
  const current = listContextDocuments().find((document) => document.sourcePath === input.sourcePath);
  if (current) {
    if (current.contentHash !== input.contentHash) updateContextDocument(current.id, { title: input.title, type: input.type, body: input.body, sourceOfTruth: input.sourceOfTruth, notes: input.notes, summary: input.summary, tags: input.tags, platforms: input.platforms, purposes: input.purposes, contentHash: input.contentHash });
    db.prepare("INSERT INTO context_asset_imports(source_path,entity_id,content_hash,deleted,imported_at) VALUES (?,?,?,?,?) ON CONFLICT(source_path) DO UPDATE SET entity_id=excluded.entity_id,content_hash=excluded.content_hash,imported_at=excluded.imported_at")
      .run(input.sourcePath, current.id, input.contentHash, 0, new Date().toISOString());
    return listContextDocuments().find((document) => document.id === current.id) || null;
  }
  const document = createContextDocument(input);
  db.prepare("INSERT INTO context_asset_imports(source_path,entity_id,content_hash,deleted,imported_at) VALUES (?,?,?,?,?) ON CONFLICT(source_path) DO UPDATE SET entity_id=excluded.entity_id,content_hash=excluded.content_hash,deleted=0,imported_at=excluded.imported_at")
    .run(input.sourcePath, document.id, input.contentHash, 0, new Date().toISOString());
  return document;
}

export function listBrandAssets() {
  return (getDatabase().prepare("SELECT * FROM brand_assets ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map(brandAssetFromRow);
}

export function createBrandAsset(input: Omit<BrandAsset, "id" | "createdAt"> & { storagePath: string }) {
  if (listContextDocuments().length + listBrandAssets().length >= MAX_FILES) throw new Error(`Marketing Hub allows at most ${MAX_FILES} combined context documents and brand assets.`);
  const now = new Date().toISOString();
  const asset = { ...input, id: id(), createdAt: now };
  getDatabase().prepare(`INSERT INTO brand_assets(id,title,type,file_name,storage_path,mime_type,width,height,size_bytes,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(asset.id, asset.title, asset.type, asset.fileName, asset.storagePath, asset.mimeType, asset.width, asset.height, asset.sizeBytes, Number(asset.active), now);
  addActivity("asset_created", `Added ${asset.title}`, "Brand asset", asset.id);
  const { storagePath: _storagePath, ...publicAsset } = asset;
  void _storagePath;
  return publicAsset;
}

export function brandAssetStoragePath(assetId: string) {
  const row = getDatabase().prepare("SELECT storage_path FROM brand_assets WHERE id=?").get(assetId) as { storage_path: string } | undefined;
  return row?.storage_path || null;
}

export function deleteBrandAsset(assetId: string) {
  const storagePath = brandAssetStoragePath(assetId);
  getDatabase().prepare("DELETE FROM brand_assets WHERE id = ?").run(assetId);
  if (storagePath && isPathInsideDataDirectory(storagePath)) fs.rmSync(storagePath, { force: true });
}

export function updateBrandAsset(assetId: string, active: boolean) {
  getDatabase().prepare("UPDATE brand_assets SET active=? WHERE id=?").run(Number(active), assetId);
  return listBrandAssets().find((asset) => asset.id === assetId) || null;
}

export function createResearchRun(run: ResearchRun) {
  getDatabase().prepare(`INSERT INTO research_runs(id,name,objective,region,status,requested_count,result_count,context_document_ids,settings,model,prompt_version,provider,usage,warnings,error,raw_output,started_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(run.id, run.name, run.objective, run.region, run.status, run.requestedCount, run.resultCount, JSON.stringify(run.contextDocumentIds), JSON.stringify(run.settings), run.model, run.promptVersion, run.provider, run.usage ? JSON.stringify(run.usage) : null, JSON.stringify(run.warnings), run.error, run.rawOutput, run.startedAt, run.completedAt);
  return run;
}

export function updateResearchRun(run: ResearchRun) {
  getDatabase().prepare(`UPDATE research_runs SET status=?,result_count=?,usage=?,warnings=?,error=?,raw_output=?,completed_at=? WHERE id=?`)
    .run(run.status, run.resultCount, run.usage ? JSON.stringify(run.usage) : null, JSON.stringify(run.warnings), run.error, run.rawOutput, run.completedAt, run.id);
}

export function listResearchRuns() {
  return (getDatabase().prepare("SELECT * FROM research_runs ORDER BY started_at DESC").all() as Array<Record<string, unknown>>).map(runFromRow);
}

export function deleteResearchRun(runId: string) {
  getDatabase().prepare("DELETE FROM research_runs WHERE id=?").run(runId);
}

export function saveLeads(runId: string, leads: LeadRecord[]) {
  const db = getDatabase();
  withTransaction(db, () => {
    for (const lead of leads) {
      db.prepare(`INSERT INTO leads(id,research_run_id,opportunity_class,organization_name,organization_type,organization_website,organization_domain,city,region,event_name,event_url,event_start_date,event_end_date,event_organizer,contact_name,contact_role,contact_email,email_category,email_source_url,contact_page_url,recommended_action,fit_explanation,evidence_summary,target_segment,sales_motion,priority_score,priority_tier,qualification,outreach_angle,next_best_action,canonical_key,last_verified_at,rejection_reason,confidence,verification_status,warnings,researched_at,review_status,selected,user_edits) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(lead.id, runId, lead.opportunityClass, lead.organizationName, lead.organizationType, lead.organizationWebsite, lead.organizationDomain, lead.city, lead.region, lead.eventName, lead.eventUrl, lead.eventStartDate, lead.eventEndDate, lead.eventOrganizer, lead.contactName, lead.contactRole, lead.contactEmail, lead.emailCategory, lead.emailSourceUrl, lead.contactPageUrl, lead.recommendedAction, lead.fitExplanation, lead.evidenceSummary, lead.targetSegment, lead.salesMotion, lead.priorityScore, lead.priorityTier, JSON.stringify(lead.qualification), lead.outreachAngle, lead.nextBestAction, lead.canonicalKey, lead.lastVerifiedAt, lead.rejectionReason, lead.confidence, lead.verificationStatus, JSON.stringify(lead.warnings), lead.researchedAt, lead.reviewStatus, Number(lead.selected), JSON.stringify(lead.userEdits));
      for (const source of lead.sources) {
        const sourceId = source.id || id();
        db.prepare(`INSERT OR IGNORE INTO research_sources(id,research_run_id,title,url,source_type,claim,citation_metadata,accessed_at) VALUES (?,?,?,?,?,?,?,?)`)
          .run(sourceId, runId, source.title, source.url, source.sourceType, source.claim, JSON.stringify(source.citationMetadata || {}), source.accessedAt);
        db.prepare("INSERT OR IGNORE INTO lead_sources(lead_id,source_id) VALUES (?,?)").run(lead.id, sourceId);
      }
    }
  });
}

export function listLeads() {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM leads ORDER BY researched_at DESC").all() as Array<Record<string, unknown>>;
  const sourceQuery = db.prepare(`SELECT s.* FROM research_sources s JOIN lead_sources ls ON ls.source_id=s.id WHERE ls.lead_id=? ORDER BY s.accessed_at DESC`);
  return rows.map((row) => leadFromRow(row, (sourceQuery.all(String(row.id)) as Array<Record<string, unknown>>).map(sourceFromRow)));
}

export function updateLead(leadId: string, patch: Partial<Pick<LeadRecord, "reviewStatus" | "selected" | "contactName" | "contactRole" | "contactEmail" | "emailCategory" | "emailSourceUrl" | "verificationStatus" | "recommendedAction" | "fitExplanation" | "rejectionReason" | "warnings" | "userEdits">>) {
  const lead = listLeads().find((item) => item.id === leadId);
  if (!lead) throw new Error("Lead not found.");
  const trackedFields = ["contactName", "contactRole", "contactEmail", "recommendedAction", "fitExplanation"] as const;
  const userEdits: Record<string, unknown> = { ...lead.userEdits };
  for (const field of trackedFields) {
    if (patch[field] === undefined || patch[field] === lead[field]) continue;
    const prior = userEdits[field] as { original?: unknown } | undefined;
    userEdits[field] = { original: prior?.original ?? lead[field], value: patch[field], editedAt: new Date().toISOString() };
  }
  const next = { ...lead, ...patch, userEdits: { ...userEdits, ...(patch.userEdits || {}) } };
  const { scoreBreakdown: _scoreBreakdown, ...signals } = next.qualification;
  void _scoreBreakdown;
  Object.assign(next, qualifyLead(next, signals));
  getDatabase().prepare(`UPDATE leads SET review_status=?,selected=?,contact_name=?,contact_role=?,contact_email=?,email_category=?,email_source_url=?,verification_status=?,recommended_action=?,fit_explanation=?,rejection_reason=?,priority_score=?,priority_tier=?,qualification=?,warnings=?,user_edits=? WHERE id=?`)
    .run(next.reviewStatus, Number(next.selected), next.contactName, next.contactRole, next.contactEmail, next.emailCategory, next.emailSourceUrl, next.verificationStatus, next.recommendedAction, next.fitExplanation, next.rejectionReason, next.priorityScore, next.priorityTier, JSON.stringify(next.qualification), JSON.stringify(next.warnings), JSON.stringify(next.userEdits), leadId);
  return next;
}

export function deleteLead(leadId: string) {
  getDatabase().prepare("DELETE FROM leads WHERE id=?").run(leadId);
}

export function mergeStoredLeads(primaryId: string, duplicateId: string) {
  if (primaryId === duplicateId) throw new Error("Choose two different lead records.");
  const leads = listLeads();
  const primary = leads.find((lead) => lead.id === primaryId);
  const duplicate = leads.find((lead) => lead.id === duplicateId);
  if (!primary || !duplicate) throw new Error("One of the duplicate leads no longer exists.");
  const db = getDatabase();
  const confidenceOrder = { low: 0, medium: 1, high: 2 };
  const mergedWarnings = Array.from(new Set([...primary.warnings, ...duplicate.warnings, `Manually merged duplicate ${duplicate.organizationName} (${duplicate.id}).`]));
  withTransaction(db, () => {
    const stronger = duplicate.priorityScore > primary.priorityScore ? duplicate : primary;
    db.prepare(`UPDATE leads SET contact_name=?,contact_role=?,contact_email=?,email_category=?,email_source_url=?,contact_page_url=?,confidence=?,target_segment=?,sales_motion=?,priority_score=?,priority_tier=?,qualification=?,outreach_angle=?,next_best_action=?,canonical_key=?,last_verified_at=?,warnings=? WHERE id=?`).run(
      primary.contactName || duplicate.contactName, primary.contactRole || duplicate.contactRole, primary.contactEmail || duplicate.contactEmail,
      primary.contactEmail ? primary.emailCategory : duplicate.emailCategory, primary.emailSourceUrl || duplicate.emailSourceUrl,
      primary.contactPageUrl || duplicate.contactPageUrl,
      confidenceOrder[duplicate.confidence] > confidenceOrder[primary.confidence] ? duplicate.confidence : primary.confidence,
      stronger.targetSegment, stronger.salesMotion, stronger.priorityScore, stronger.priorityTier, JSON.stringify(stronger.qualification),
      primary.outreachAngle || duplicate.outreachAngle, primary.nextBestAction || duplicate.nextBestAction,
      primary.canonicalKey || duplicate.canonicalKey, duplicate.lastVerifiedAt > primary.lastVerifiedAt ? duplicate.lastVerifiedAt : primary.lastVerifiedAt,
      JSON.stringify(mergedWarnings), primaryId
    );
    db.prepare("INSERT OR IGNORE INTO lead_sources(lead_id,source_id) SELECT ?,source_id FROM lead_sources WHERE lead_id=?").run(primaryId, duplicateId);
    db.prepare("DELETE FROM leads WHERE id=?").run(duplicateId);
  });
  return listLeads().find((lead) => lead.id === primaryId);
}

export function createOutreachCampaign(campaign: OutreachCampaign) {
  const db = getDatabase();
  withTransaction(db, () => {
    db.prepare(`INSERT INTO outreach_campaigns(id,name,mode,status,context_document_ids,subject_template,body_template,call_to_action,preview_text,forwardable_announcement,model,prompt_version,provider,usage,warnings,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(campaign.id, campaign.name, campaign.mode, campaign.status, JSON.stringify(campaign.contextDocumentIds), campaign.subjectTemplate, campaign.bodyTemplate, campaign.callToAction, campaign.previewText, campaign.forwardableAnnouncement, campaign.model, campaign.promptVersion, campaign.provider, campaign.usage ? JSON.stringify(campaign.usage) : null, JSON.stringify(campaign.warnings), campaign.createdAt, campaign.updatedAt);
    for (const recipient of campaign.recipients) {
      db.prepare(`INSERT INTO outreach_recipients(id,campaign_id,lead_id,email,subject,body,forwardable_announcement,review_status,excluded,warnings) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(recipient.id, campaign.id, recipient.leadId, recipient.email, recipient.subject, recipient.body, recipient.forwardableAnnouncement, recipient.reviewStatus, Number(recipient.excluded), JSON.stringify(recipient.warnings));
    }
  });
  addActivity("outreach_created", campaign.name, `${campaign.recipients.length} recipients`, campaign.id);
  return campaign;
}

function recipientFromRow(row: Record<string, unknown>): OutreachRecipient {
  return { id: String(row.id), campaignId: String(row.campaign_id), leadId: String(row.lead_id), email: row.email ? String(row.email) : null, subject: String(row.subject), body: String(row.body), forwardableAnnouncement: String(row.forwardable_announcement), reviewStatus: row.review_status as OutreachRecipient["reviewStatus"], excluded: bool(row.excluded), warnings: json(String(row.warnings), []) };
}

export function listOutreachCampaigns() {
  const db = getDatabase();
  return (db.prepare("SELECT * FROM outreach_campaigns ORDER BY updated_at DESC").all() as Array<Record<string, unknown>>).map((row): OutreachCampaign => ({
    id: String(row.id), name: String(row.name), mode: row.mode as OutreachCampaign["mode"], status: row.status as OutreachCampaign["status"],
    contextDocumentIds: json(String(row.context_document_ids), []), subjectTemplate: String(row.subject_template), bodyTemplate: String(row.body_template), callToAction: String(row.call_to_action || ""), previewText: String(row.preview_text || ""),
    forwardableAnnouncement: String(row.forwardable_announcement), model: String(row.model || ""), promptVersion: String(row.prompt_version || "outreach-v1"), provider: row.provider as OutreachCampaign["provider"], usage: row.usage ? json(String(row.usage), {}) : null, warnings: json(String(row.warnings), []), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    recipients: (db.prepare("SELECT * FROM outreach_recipients WHERE campaign_id=?").all(String(row.id)) as Array<Record<string, unknown>>).map(recipientFromRow)
  }));
}

export function updateOutreachRecipient(recipientId: string, patch: Partial<Pick<OutreachRecipient, "subject" | "body" | "forwardableAnnouncement" | "reviewStatus" | "excluded" | "warnings">>) {
  const row = getDatabase().prepare("SELECT * FROM outreach_recipients WHERE id=?").get(recipientId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Recipient not found.");
  const next = { ...recipientFromRow(row), ...patch };
  getDatabase().prepare("UPDATE outreach_recipients SET subject=?,body=?,forwardable_announcement=?,review_status=?,excluded=?,warnings=? WHERE id=?").run(next.subject, next.body, next.forwardableAnnouncement, next.reviewStatus, Number(next.excluded), JSON.stringify(next.warnings), recipientId);
  return next;
}

export function updateOutreachCampaign(campaignId: string, patch: Partial<Pick<OutreachCampaign, "subjectTemplate" | "bodyTemplate" | "callToAction" | "previewText" | "forwardableAnnouncement" | "status">>) {
  const campaign = listOutreachCampaigns().find((item) => item.id === campaignId);
  if (!campaign) throw new Error("Outreach campaign not found.");
  const next = { ...campaign, ...patch, updatedAt: new Date().toISOString() };
  getDatabase().prepare("UPDATE outreach_campaigns SET subject_template=?,body_template=?,call_to_action=?,preview_text=?,forwardable_announcement=?,status=?,updated_at=? WHERE id=?")
    .run(next.subjectTemplate, next.bodyTemplate, next.callToAction, next.previewText, next.forwardableAnnouncement, next.status, next.updatedAt, campaignId);
  return next;
}

export function deleteOutreachCampaign(campaignId: string) {
  getDatabase().prepare("DELETE FROM outreach_campaigns WHERE id=?").run(campaignId);
}

export function createContentCampaign(campaign: ContentCampaign) {
  const db = getDatabase();
  withTransaction(db, () => {
    db.prepare(`INSERT INTO content_campaigns(id,name,brief,objective,target_audience,call_to_action,required_phrases,prohibited_phrases,headline,image_direction,image_generation_enabled,selected_brand_asset_id,context_document_ids,platforms,status,model,prompt_version,provider,usage,warnings,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(campaign.id, campaign.name, campaign.brief, campaign.objective, campaign.targetAudience, campaign.callToAction, campaign.requiredPhrases, campaign.prohibitedPhrases, campaign.headline, campaign.imageDirection, Number(campaign.imageGenerationEnabled), campaign.selectedBrandAssetId, JSON.stringify(campaign.contextDocumentIds), JSON.stringify(campaign.platforms), campaign.status, campaign.model, campaign.promptVersion, campaign.provider, campaign.usage ? JSON.stringify(campaign.usage) : null, JSON.stringify(campaign.warnings), campaign.error, campaign.createdAt, campaign.updatedAt);
    for (const post of campaign.posts) insertPost(post);
  });
  addActivity(campaign.status === "failed" ? "content_failed" : "content_created", campaign.name, campaign.status === "failed" ? "Content generation failed; the run remains inspectable." : `${campaign.posts.length} platform drafts`, campaign.id);
  return campaign;
}

function insertPost(post: PlatformPost) {
  getDatabase().prepare(`INSERT INTO platform_posts(id,campaign_id,platform,text,hook,call_to_action,hashtags,image_headline,image_subheadline,image_alt_text,image_prompt,warnings,style_guide_status,review_status,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(post.id, post.campaignId, post.platform, post.text, post.hook, post.callToAction, post.hashtags, post.imageHeadline, post.imageSubheadline, post.imageAltText, post.imagePrompt, JSON.stringify(post.warnings), post.styleGuideStatus, post.reviewStatus, post.version);
}

export function listContentCampaigns() {
  const db = getDatabase();
  return (db.prepare("SELECT * FROM content_campaigns ORDER BY updated_at DESC").all() as Array<Record<string, unknown>>).map((row): ContentCampaign => ({
    id: String(row.id), name: String(row.name), brief: String(row.brief), objective: String(row.objective), targetAudience: String(row.target_audience),
    callToAction: String(row.call_to_action), requiredPhrases: String(row.required_phrases), prohibitedPhrases: String(row.prohibited_phrases), headline: String(row.headline), imageDirection: String(row.image_direction), imageGenerationEnabled: bool(row.image_generation_enabled), selectedBrandAssetId: row.selected_brand_asset_id ? String(row.selected_brand_asset_id) : null,
    contextDocumentIds: json(String(row.context_document_ids), []), platforms: json(String(row.platforms), []), status: row.status as ContentCampaign["status"], model: String(row.model), promptVersion: String(row.prompt_version), provider: row.provider as ContentCampaign["provider"], usage: row.usage ? json(String(row.usage), {}) : null,
    warnings: json(String(row.warnings), []), error: row.error ? String(row.error) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    posts: (db.prepare("SELECT * FROM platform_posts WHERE campaign_id=? ORDER BY platform").all(String(row.id)) as Array<Record<string, unknown>>).map(postFromRow),
    assets: (db.prepare("SELECT * FROM generated_assets WHERE campaign_id=? ORDER BY created_at DESC").all(String(row.id)) as Array<Record<string, unknown>>).map(generatedFromRow)
  }));
}

export function updatePlatformPost(postId: string, patch: Partial<Pick<PlatformPost, "text" | "hook" | "callToAction" | "hashtags" | "imageHeadline" | "imageSubheadline" | "imageAltText" | "reviewStatus">>) {
  const row = getDatabase().prepare("SELECT * FROM platform_posts WHERE id=?").get(postId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Platform post not found.");
  const next = { ...postFromRow(row), ...patch, version: Number(row.version) + 1 };
  getDatabase().prepare(`UPDATE platform_posts SET text=?,hook=?,call_to_action=?,hashtags=?,image_headline=?,image_subheadline=?,image_alt_text=?,review_status=?,version=? WHERE id=?`)
    .run(next.text, next.hook, next.callToAction, next.hashtags, next.imageHeadline, next.imageSubheadline, next.imageAltText, next.reviewStatus, next.version, postId);
  getDatabase().prepare("UPDATE content_campaigns SET updated_at=? WHERE id=?").run(new Date().toISOString(), next.campaignId);
  return next;
}

export function replacePlatformPost(postId: string, replacement: Omit<PlatformPost, "id" | "campaignId" | "version" | "reviewStatus">) {
  const row = getDatabase().prepare("SELECT * FROM platform_posts WHERE id=?").get(postId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Platform post not found.");
  const current = postFromRow(row);
  const next: PlatformPost = { ...current, ...replacement, reviewStatus: "unreviewed", version: current.version + 1 };
  getDatabase().prepare(`UPDATE platform_posts SET text=?,hook=?,call_to_action=?,hashtags=?,image_headline=?,image_subheadline=?,image_alt_text=?,image_prompt=?,warnings=?,style_guide_status=?,review_status=?,version=? WHERE id=?`)
    .run(next.text, next.hook, next.callToAction, next.hashtags, next.imageHeadline, next.imageSubheadline, next.imageAltText, next.imagePrompt, JSON.stringify(next.warnings), next.styleGuideStatus, next.reviewStatus, next.version, postId);
  getDatabase().prepare("UPDATE content_campaigns SET updated_at=? WHERE id=?").run(new Date().toISOString(), current.campaignId);
  return next;
}

export function addGeneratedAsset(input: GeneratedAsset & { storagePath: string }) {
  getDatabase().prepare(`INSERT INTO generated_assets(id,campaign_id,kind,file_name,storage_path,mime_type,width,height,prompt,overlay,model,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(input.id, input.campaignId, input.kind, input.fileName, input.storagePath, input.mimeType, input.width, input.height, input.prompt, JSON.stringify(input.overlay), input.model, input.createdAt);
  const { storagePath: _storagePath, ...asset } = input;
  void _storagePath;
  return asset;
}

export function generatedAssetStoragePath(assetId: string) {
  const row = getDatabase().prepare("SELECT storage_path FROM generated_assets WHERE id=?").get(assetId) as { storage_path: string } | undefined;
  return row?.storage_path || null;
}

export function deleteGeneratedAsset(assetId: string) {
  const storagePath = generatedAssetStoragePath(assetId);
  getDatabase().prepare("DELETE FROM generated_assets WHERE id=?").run(assetId);
  if (storagePath && isPathInsideDataDirectory(storagePath)) fs.rmSync(storagePath, { force: true });
}

export function deleteContentCampaign(campaignId: string) {
  const db = getDatabase();
  const rows = db.prepare("SELECT storage_path FROM generated_assets WHERE campaign_id=?").all(campaignId) as Array<{ storage_path: string }>;
  db.prepare("DELETE FROM content_campaigns WHERE id=?").run(campaignId);
  for (const row of rows) if (isPathInsideDataDirectory(row.storage_path)) fs.rmSync(row.storage_path, { force: true });
}

function spotlightResultFromRow(row: Record<string, unknown>): SpeakerSpotlightResult {
  const storedQa = row.qa ? json<SpeakerSpotlightResult["qa"]>(String(row.qa), null) : null;
  const qa = storedQa ? {
    ...storedQa,
    imageValidationMode: storedQa.imageValidationMode || "vision_qa",
    imageAttemptResults: storedQa.imageAttemptResults || [],
    humanReviewApprovedAt: storedQa.humanReviewApprovedAt || null
  } : null;
  return {
    id: String(row.id), batchId: String(row.batch_id), inputName: String(row.input_name), profileKey: String(row.profile_key),
    slug: String(row.slug), status: row.status as SpeakerSpotlightResult["status"], profile: row.profile ? json(String(row.profile), null) : null,
    post: row.post ? String(row.post) : null, headshotFileName: row.headshot_file_name ? String(row.headshot_file_name) : null,
    imageFileName: row.image_file_name ? String(row.image_file_name) : null, headshotAssetId: row.headshot_asset_id ? String(row.headshot_asset_id) : null,
    imageAssetId: row.image_asset_id ? String(row.image_asset_id) : null, imagePrompt: row.image_prompt ? String(row.image_prompt) : null,
    qa, requestIds: json(String(row.request_ids || "[]"), []), retryCount: Number(row.retry_count || 0),
    providerError: row.provider_error ? json(String(row.provider_error), null) : null,
    error: row.error ? String(row.error) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

export function createSpeakerSpotlightBatch(batch: SpeakerSpotlightBatch) {
  const db = getDatabase();
  withTransaction(db, () => {
    db.prepare(`INSERT INTO speaker_spotlight_batches(id,speaker_names,status,config,model,prompt_version,provider,warnings,error,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(batch.id, JSON.stringify(batch.speakerNames), batch.status, JSON.stringify(batch.config), batch.model, batch.promptVersion, batch.provider, JSON.stringify(batch.warnings), batch.error, batch.createdAt, batch.completedAt);
    for (const result of batch.results) {
      db.prepare(`INSERT INTO speaker_spotlight_results(id,batch_id,input_name,profile_key,slug,status,profile,post,headshot_file_name,image_file_name,headshot_asset_id,image_asset_id,headshot_storage_path,image_storage_path,image_prompt,qa,request_ids,retry_count,provider_error,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(result.id, result.batchId, result.inputName, result.profileKey, result.slug, result.status, result.profile ? JSON.stringify(result.profile) : null, result.post, result.headshotFileName, result.imageFileName, result.headshotAssetId, result.imageAssetId, null, null, result.imagePrompt, result.qa ? JSON.stringify(result.qa) : null, JSON.stringify(result.requestIds), result.retryCount, result.providerError ? JSON.stringify(result.providerError) : null, result.error, result.createdAt, result.updatedAt);
    }
  });
  addActivity("speaker_spotlight_started", "Speaker Spotlight batch", `${batch.speakerNames.length} speakers`, batch.id);
  return batch;
}

export function updateSpeakerSpotlightBatch(batchId: string, patch: Partial<Pick<SpeakerSpotlightBatch, "status" | "warnings" | "error" | "completedAt">>) {
  const batch = listSpeakerSpotlightBatches().find((item) => item.id === batchId);
  if (!batch) throw new Error("Speaker Spotlight batch not found.");
  const next = { ...batch, ...patch };
  getDatabase().prepare("UPDATE speaker_spotlight_batches SET status=?,warnings=?,error=?,completed_at=? WHERE id=?")
    .run(next.status, JSON.stringify(next.warnings), next.error, next.completedAt, batchId);
  if (next.completedAt) addActivity("speaker_spotlight_completed", "Speaker Spotlight batch", `${next.results.filter((result) => result.status === "completed").length} completed`, batchId);
  return next;
}

export function updateSpeakerSpotlightResult(resultId: string, patch: Partial<SpeakerSpotlightResult> & { headshotStoragePath?: string | null; imageStoragePath?: string | null }) {
  const row = getDatabase().prepare("SELECT * FROM speaker_spotlight_results WHERE id=?").get(resultId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Speaker Spotlight result not found.");
  const current = spotlightResultFromRow(row);
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  getDatabase().prepare(`UPDATE speaker_spotlight_results SET profile_key=?,slug=?,status=?,profile=?,post=?,headshot_file_name=?,image_file_name=?,headshot_asset_id=?,image_asset_id=?,headshot_storage_path=COALESCE(?,headshot_storage_path),image_storage_path=COALESCE(?,image_storage_path),image_prompt=?,qa=?,request_ids=?,retry_count=?,provider_error=?,error=?,updated_at=? WHERE id=?`)
    .run(next.profileKey, next.slug, next.status, next.profile ? JSON.stringify(next.profile) : null, next.post, next.headshotFileName, next.imageFileName, next.headshotAssetId, next.imageAssetId, patch.headshotStoragePath ?? null, patch.imageStoragePath ?? null, next.imagePrompt, next.qa ? JSON.stringify(next.qa) : null, JSON.stringify(next.requestIds), next.retryCount, next.providerError ? JSON.stringify(next.providerError) : null, next.error, next.updatedAt, resultId);
  return next;
}

export function speakerSpotlightResultStorage(resultId: string) {
  const row = getDatabase().prepare("SELECT headshot_storage_path,image_storage_path FROM speaker_spotlight_results WHERE id=?").get(resultId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    headshotPath: row.headshot_storage_path ? String(row.headshot_storage_path) : null,
    imagePath: row.image_storage_path ? String(row.image_storage_path) : null
  };
}

export function listSpeakerSpotlightBatches() {
  const db = getDatabase();
  return (db.prepare("SELECT * FROM speaker_spotlight_batches ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map((row): SpeakerSpotlightBatch => ({
    id: String(row.id), speakerNames: json(String(row.speaker_names), []), status: row.status as SpeakerSpotlightBatch["status"],
    config: json(String(row.config), {} as SpeakerSpotlightBatch["config"]), model: String(row.model), promptVersion: String(row.prompt_version),
    provider: row.provider as SpeakerSpotlightBatch["provider"], warnings: json(String(row.warnings || "[]"), []), error: row.error ? String(row.error) : null,
    createdAt: String(row.created_at), completedAt: row.completed_at ? String(row.completed_at) : null,
    results: (db.prepare("SELECT * FROM speaker_spotlight_results WHERE batch_id=? ORDER BY created_at").all(String(row.id)) as Array<Record<string, unknown>>).map(spotlightResultFromRow)
  }));
}

export function speakerSpotlightAssetStoragePath(assetId: string) {
  const row = getDatabase().prepare("SELECT headshot_asset_id,image_asset_id,headshot_storage_path,image_storage_path FROM speaker_spotlight_results WHERE headshot_asset_id=? OR image_asset_id=?").get(assetId, assetId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return row.headshot_asset_id === assetId ? String(row.headshot_storage_path || "") || null : String(row.image_storage_path || "") || null;
}

export function deleteSpeakerSpotlightBatch(batchId: string) {
  const db = getDatabase();
  const rows = db.prepare("SELECT headshot_storage_path,image_storage_path FROM speaker_spotlight_results WHERE batch_id=?").all(batchId) as Array<Record<string, unknown>>;
  db.prepare("DELETE FROM speaker_spotlight_batches WHERE id=?").run(batchId);
  const batchRoot = rows.flatMap((row) => [row.headshot_storage_path, row.image_storage_path]).find(Boolean);
  if (batchRoot) {
    const directory = path.dirname(path.dirname(String(batchRoot)));
    if (isPathInsideDataDirectory(directory)) fs.rmSync(directory, { recursive: true, force: true });
  }
}

export function addActivity(type: string, title: string, detail: string, entityId?: string) {
  getDatabase().prepare("INSERT INTO activity_events(id,type,title,detail,entity_id,created_at) VALUES (?,?,?,?,?,?)")
    .run(id(), type, title, detail, entityId || null, new Date().toISOString());
}

export function getWorkspaceState(connection: WorkspaceState["connection"]): WorkspaceState {
  const contextDocuments = listContextDocuments();
  const leads = listLeads();
  const contentCampaigns = listContentCampaigns();
  return {
    demoMode: isDemoMode(), dataPath: dataDirectory(), connection, contextDocuments, brandAssets: listBrandAssets(),
    researchRuns: listResearchRuns(), leads, outreachCampaigns: listOutreachCampaigns(), contentCampaigns, speakerSpotlightBatches: listSpeakerSpotlightBatches(),
    counts: { activeContext: contextDocuments.filter((document) => document.active).length, leads: leads.length, awaitingReview: leads.filter((lead) => lead.reviewStatus === "unreviewed" || lead.reviewStatus === "needs_review").length, campaigns: contentCampaigns.length, speakerSpotlights: listSpeakerSpotlightBatches().reduce((sum, batch) => sum + batch.results.filter((result) => result.status === "completed").length, 0) }
  };
}

export function resetAllData() {
  const db = getDatabase();
  withTransaction(db, () => {
    for (const table of ["ai_operations", "activity_events", "speaker_spotlight_results", "speaker_spotlight_batches", "generated_assets", "platform_posts", "content_campaigns", "outreach_recipients", "outreach_campaigns", "lead_sources", "leads", "research_sources", "research_runs", "brand_assets", "context_documents", "context_asset_imports"]) db.prepare(`DELETE FROM ${table}`).run();
  });
  for (const name of ["uploads", "generated", "exports", "tmp", "speaker_spotlights"]) fs.rmSync(path.join(dataDirectory(), name), { recursive: true, force: true });
  ensureDataDirectories();
}
