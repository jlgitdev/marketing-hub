import crypto from "node:crypto";
import type { z } from "zod";
import { LeadCandidateSchema, type ResearchBundle } from "@/server/ai/schemas";
import type { LeadRecord, SupportingSource } from "@/lib/types";
import { emailDomain, emailSchema, isConsumerEmail, isMultiTenantPlatformDomain, normalizeDomain, normalizeEmail, normalizeEvidenceUrl, normalizeOrganizationName, validatePublicSourceUrl } from "@/server/security/validation";
import { canonicalLeadKey, qualifyLead } from "./lead-qualification";

export function validateAndNormalizeLeads(bundle: ResearchBundle, runId: string, sourceMetadata: Map<string, Record<string, unknown>> = new Map()) {
  const normalized: LeadRecord[] = [];
  for (const raw of bundle.leads) {
    const parsed = LeadCandidateSchema.safeParse(raw);
    if (!parsed.success) continue;
    const candidate = normalizeProviderCandidate(parsed.data);
    const warnings = [...candidate.warnings];
    const observedSources: SupportingSource[] = candidate.supportingSources
      .filter((source) => validatePublicSourceUrl(source.url))
      .filter((source) => sourceMetadata.size === 0 || sourceMetadata.has(source.url))
      .map((source) => ({ ...source, id: crypto.randomUUID(), citationMetadata: sourceMetadata.get(source.url) || {}, accessedAt: source.accessedAt || new Date().toISOString() }));
    const sources = observedSources.filter((source) => sourceSupportsCandidate(source, candidate));
    if (sources.length < observedSources.length) warnings.push(`${observedSources.length - sources.length} observed source${observedSources.length - sources.length === 1 ? " was" : "s were"} removed because the page did not match the candidate organization, event, or declared contact path.`);
    if (sources.length === 0) continue;
    const sourceUrls = new Set(sources.map((source) => source.url));
    let contactEmail = candidate.contactEmail ? normalizeEmail(candidate.contactEmail) : null;
    let emailSourceUrl = candidate.emailSourceUrl;
    let emailCategory = candidate.emailCategory;
    const contactPageSource = candidate.contactPageUrl
      ? sources.find((source) => source.url === candidate.contactPageUrl && ["official", "event"].includes(source.sourceType))
      : null;
    const contactPageUrl = candidate.contactPageUrl && validatePublicSourceUrl(candidate.contactPageUrl) && contactPageSource
      ? candidate.contactPageUrl
      : null;
    if (candidate.contactPageUrl && !contactPageUrl) warnings.push("A model-suggested contact page was removed because it was not backed by an accepted official or event source.");
    let verificationStatus: LeadRecord["verificationStatus"] = contactPageUrl ? "contact_page_only" : "requires_review";

    const exactEmailSource = contactEmail && emailSourceUrl ? sources.find((source) => source.url === emailSourceUrl && source.claim.toLowerCase().includes(contactEmail!.toLowerCase())) : null;
    if (contactEmail && (!emailSchema.safeParse(contactEmail).success || !emailSourceUrl || !sourceUrls.has(emailSourceUrl) || !exactEmailSource)) {
      warnings.push("A model-suggested email was removed because the exact address did not have an accepted supporting public URL.");
      contactEmail = null;
      emailSourceUrl = null;
      emailCategory = "none";
      verificationStatus = contactPageUrl ? "contact_page_only" : "requires_review";
    }
    if (contactEmail && exactEmailSource) verificationStatus = ["official", "event"].includes(exactEmailSource.sourceType) ? "source_backed" : "requires_review";
    if (contactEmail && isConsumerEmail(contactEmail)) {
      warnings.push("Consumer-domain address requires manual review even though a source was supplied.");
      verificationStatus = "requires_review";
    }
    if (contactEmail && exactEmailSource && !["official", "event"].includes(exactEmailSource.sourceType)) {
      warnings.push("The exact email appears only on a third-party source; prefer an official source before outreach.");
      verificationStatus = "requires_review";
    }
    const organizationDomain = normalizeDomain(candidate.organizationWebsite);
    if (contactEmail && organizationDomain && !isConsumerEmail(contactEmail) && !organizationDomain.endsWith(emailDomain(contactEmail)) && !emailDomain(contactEmail).endsWith(organizationDomain)) {
      warnings.push("The published professional email domain differs from the organization website domain; inspect the source before outreach.");
      verificationStatus = "requires_review";
    }
    const eventStartDate = normalizeDate(candidate.eventStartDate);
    if (candidate.opportunityClass === "event" && eventStartDate && eventStartDate < new Date().toISOString().slice(0, 10)) warnings.push("The researched event date is in the past and should not be treated as an upcoming opportunity.");
    if (!contactEmail && !contactPageUrl) warnings.push("No source-backed email or official contact page was found.");

    const researchedAt = new Date().toISOString();
    const base = {
      id: crypto.randomUUID(), researchRunId: runId, opportunityClass: candidate.opportunityClass,
      organizationName: candidate.organizationName.trim(), organizationType: candidate.organizationType.trim(),
      organizationWebsite: candidate.organizationWebsite && validatePublicSourceUrl(candidate.organizationWebsite) ? candidate.organizationWebsite : null,
      organizationDomain, city: candidate.city.trim(), region: candidate.region.trim(),
      eventName: candidate.eventName, eventUrl: candidate.eventUrl && validatePublicSourceUrl(candidate.eventUrl) ? candidate.eventUrl : null,
      eventStartDate, eventEndDate: normalizeDate(candidate.eventEndDate), eventOrganizer: candidate.eventOrganizer,
      contactName: candidate.contactName, contactRole: candidate.contactRole, contactEmail, emailCategory, emailSourceUrl,
      contactPageUrl,
      recommendedAction: candidate.recommendedAction.trim(), fitExplanation: candidate.fitExplanation.trim(), evidenceSummary: candidate.evidenceSummary.trim(),
      targetSegment: candidate.targetSegment, salesMotion: candidate.salesMotion,
      outreachAngle: candidate.outreachAngle.trim(), nextBestAction: candidate.nextBestAction.trim(),
      confidence: candidate.opportunityClass === "event" && eventStartDate && eventStartDate < new Date().toISOString().slice(0, 10) ? "low" : contactEmail && sources.length >= 2 ? candidate.confidence : candidate.confidence === "high" ? "medium" : candidate.confidence,
      verificationStatus, warnings, researchedAt, lastVerifiedAt: researchedAt, reviewStatus: "unreviewed" as const, selected: false, userEdits: {}, sources,
      priorityScore: 0, priorityTier: "nurture" as const, qualification: {} as LeadRecord["qualification"], canonicalKey: "", rejectionReason: null
    } satisfies LeadRecord;
    base.canonicalKey = canonicalLeadKey(base);
    const scored = qualifyLead(base, candidate.qualificationSignals);
    normalized.push({ ...base, ...scored });
  }
  return deduplicateLeads(normalized);
}

function normalizeProviderCandidate(candidate: z.infer<typeof LeadCandidateSchema>) {
  const clean = (value: string) => value.trim().replace(/^(?:>\s*)+/, "").trim();
  const cleanNullable = (value: string | null) => {
    if (value === null) return null;
    const cleaned = clean(value);
    return /^[\s:'",;{}\[\]]*(?:null|none|n\/a)[\s:'",;{}\[\]]*$/i.test(cleaned) ? null : cleaned;
  };
  const cleanUrl = (value: string) => {
    const cleaned = clean(value);
    return normalizeEvidenceUrl(cleaned) || cleaned;
  };
  const cleanNullableUrl = (value: string | null) => {
    const cleaned = cleanNullable(value);
    return cleaned === null ? null : cleanUrl(cleaned);
  };

  return {
    ...candidate,
    organizationName: clean(candidate.organizationName),
    organizationType: clean(candidate.organizationType),
    organizationWebsite: cleanNullableUrl(candidate.organizationWebsite),
    city: clean(candidate.city),
    region: clean(candidate.region),
    eventName: cleanNullable(candidate.eventName),
    eventUrl: cleanNullableUrl(candidate.eventUrl),
    eventStartDate: cleanNullable(candidate.eventStartDate),
    eventEndDate: cleanNullable(candidate.eventEndDate),
    eventOrganizer: cleanNullable(candidate.eventOrganizer),
    contactName: cleanNullable(candidate.contactName),
    contactRole: cleanNullable(candidate.contactRole),
    contactEmail: cleanNullable(candidate.contactEmail),
    emailSourceUrl: cleanNullableUrl(candidate.emailSourceUrl),
    contactPageUrl: cleanNullableUrl(candidate.contactPageUrl),
    recommendedAction: clean(candidate.recommendedAction),
    fitExplanation: clean(candidate.fitExplanation),
    evidenceSummary: clean(candidate.evidenceSummary),
    outreachAngle: clean(candidate.outreachAngle),
    nextBestAction: clean(candidate.nextBestAction),
    qualificationSignals: { ...candidate.qualificationSignals, audienceSizeLabel: cleanNullable(candidate.qualificationSignals.audienceSizeLabel) },
    warnings: candidate.warnings.map(clean),
    supportingSources: candidate.supportingSources.map((source) => ({
      ...source,
      title: clean(source.title),
      url: cleanUrl(source.url),
      claim: clean(source.claim),
      accessedAt: clean(source.accessedAt)
    }))
  };
}

function sourceSupportsCandidate(source: Pick<SupportingSource, "title" | "url" | "claim">, candidate: z.infer<typeof LeadCandidateSchema>) {
  if (source.url === candidate.emailSourceUrl || source.url === candidate.contactPageUrl) return true;
  const sourceDomain = normalizeDomain(source.url);
  const knownUrls = [candidate.organizationWebsite, candidate.eventUrl].filter((value): value is string => Boolean(value));
  if (sourceDomain && knownUrls.some((value) => {
    const knownDomain = normalizeDomain(value);
    if (!knownDomain || (sourceDomain !== knownDomain && !sourceDomain.endsWith(`.${knownDomain}`) && !knownDomain.endsWith(`.${sourceDomain}`))) return false;
    if (!isMultiTenantPlatformDomain(sourceDomain)) return true;
    const sourcePath = new URL(source.url).pathname.replace(/\/+$/, "");
    const knownPath = new URL(value).pathname.replace(/\/+$/, "");
    return Boolean(knownPath && knownPath !== "/" && (sourcePath === knownPath || sourcePath.startsWith(`${knownPath}/`) || knownPath.startsWith(`${sourcePath}/`)));
  })) return true;

  const stopwords = new Set(["area", "association", "chapter", "club", "community", "company", "foundation", "group", "network", "organization", "program", "silicon", "valley", "francisco"]);
  const identityTokens = Array.from(new Set(normalizeOrganizationName(`${candidate.organizationName} ${candidate.eventName || ""}`)
    .split(" ").filter((token) => (token === "ai" || token.length >= 4) && !stopwords.has(token))));
  if (!identityTokens.length) return false;
  const sourceText = normalizeOrganizationName(`${source.title} ${source.claim} ${source.url}`);
  const matches = identityTokens.filter((token) => sourceText.includes(token)).length;
  return matches >= Math.min(2, identityTokens.length);
}

function normalizeDate(value: string | null) {
  if (!value) return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}$/);
  if (!match || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return null;
  return value;
}

export function deduplicateLeads(leads: LeadRecord[]) {
  const result: LeadRecord[] = [];
  const keys = new Map<string, number>();
  for (const lead of leads) {
    const emailKey = lead.contactEmail ? `email:${normalizeEmail(lead.contactEmail)}` : null;
    const domainKey = lead.organizationDomain && !isMultiTenantPlatformDomain(lead.organizationDomain) ? `domain:${lead.organizationDomain}:${normalizeOrganizationName(lead.eventName || "")}` : null;
    const nameKey = `name:${normalizeOrganizationName(lead.organizationName)}:${normalizeOrganizationName(lead.eventName || "")}`;
    const matchedIndex = [emailKey, domainKey, nameKey].filter(Boolean).map((key) => keys.get(key as string)).find((index) => index !== undefined);
    if (matchedIndex === undefined) {
      const index = result.push(lead) - 1;
      for (const key of [emailKey, domainKey, nameKey].filter(Boolean)) keys.set(key as string, index);
      continue;
    }
    const current = result[matchedIndex];
    result[matchedIndex] = mergeLeads(current, lead);
  }
  return result;
}

export function mergeLeads(primary: LeadRecord, duplicate: LeadRecord): LeadRecord {
  const sourceMap = new Map<string, SupportingSource>();
  for (const source of [...primary.sources, ...duplicate.sources]) sourceMap.set(source.url, source);
  const confidenceOrder = { low: 0, medium: 1, high: 2 };
  const stronger = duplicate.priorityScore > primary.priorityScore ? duplicate : primary;
  const other = stronger === primary ? duplicate : primary;
  const contactRank = (lead: LeadRecord) => lead.contactEmail && lead.verificationStatus === "source_backed" ? 3 : lead.contactEmail ? 2 : lead.contactPageUrl ? 1 : 0;
  const contactLead = contactRank(duplicate) > contactRank(primary) ? duplicate : primary;
  const contactPageUrl = primary.contactPageUrl || duplicate.contactPageUrl;
  const merged: LeadRecord = {
    ...stronger,
    contactEmail: contactLead.contactEmail,
    emailCategory: contactLead.contactEmail ? contactLead.emailCategory : "none",
    emailSourceUrl: contactLead.contactEmail ? contactLead.emailSourceUrl : null,
    contactPageUrl,
    contactName: contactLead.contactName || other.contactName,
    contactRole: contactLead.contactRole || other.contactRole,
    verificationStatus: contactLead.contactEmail ? contactLead.verificationStatus : contactPageUrl ? "contact_page_only" : "requires_review",
    confidence: confidenceOrder[duplicate.confidence] > confidenceOrder[primary.confidence] ? duplicate.confidence : primary.confidence,
    outreachAngle: stronger.outreachAngle || other.outreachAngle,
    nextBestAction: stronger.nextBestAction || other.nextBestAction,
    warnings: Array.from(new Set([...primary.warnings, ...duplicate.warnings, `Merged duplicate record ${duplicate.id}.`])),
    sources: Array.from(sourceMap.values())
  };
  const { scoreBreakdown: _scoreBreakdown, ...signals } = stronger.qualification;
  void _scoreBreakdown;
  return { ...merged, ...qualifyLead(merged, signals) };
}
