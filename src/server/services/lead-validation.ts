import crypto from "node:crypto";
import type { z } from "zod";
import { LeadCandidateSchema, type ResearchBundle } from "@/server/ai/schemas";
import type { LeadRecord, SupportingSource } from "@/lib/types";
import { emailDomain, emailSchema, isConsumerEmail, normalizeDomain, normalizeEmail, normalizeOrganizationName, validatePublicSourceUrl } from "@/server/security/validation";

export function validateAndNormalizeLeads(bundle: ResearchBundle, runId: string, sourceMetadata: Map<string, Record<string, unknown>> = new Map()) {
  const normalized: LeadRecord[] = [];
  for (const raw of bundle.leads) {
    const parsed = LeadCandidateSchema.safeParse(raw);
    if (!parsed.success) continue;
    const candidate = normalizeProviderCandidate(parsed.data);
    const warnings = [...candidate.warnings];
    const sources: SupportingSource[] = candidate.supportingSources
      .filter((source) => validatePublicSourceUrl(source.url))
      .filter((source) => sourceMetadata.size === 0 || sourceMetadata.has(source.url))
      .map((source) => ({ ...source, id: crypto.randomUUID(), citationMetadata: sourceMetadata.get(source.url) || {}, accessedAt: source.accessedAt || new Date().toISOString() }));
    if (sources.length === 0) continue;
    const sourceUrls = new Set(sources.map((source) => source.url));
    let contactEmail = candidate.contactEmail ? normalizeEmail(candidate.contactEmail) : null;
    let emailSourceUrl = candidate.emailSourceUrl;
    let emailCategory = candidate.emailCategory;
    let verificationStatus = candidate.verificationStatus;

    const exactEmailSource = contactEmail && emailSourceUrl ? sources.find((source) => source.url === emailSourceUrl && source.claim.toLowerCase().includes(contactEmail!.toLowerCase())) : null;
    if (contactEmail && (!emailSchema.safeParse(contactEmail).success || !emailSourceUrl || !sourceUrls.has(emailSourceUrl) || !exactEmailSource)) {
      warnings.push("A model-suggested email was removed because the exact address did not have an accepted supporting public URL.");
      contactEmail = null;
      emailSourceUrl = null;
      emailCategory = "none";
      verificationStatus = candidate.contactPageUrl ? "contact_page_only" : "requires_review";
    }
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
    if (!contactEmail && !candidate.contactPageUrl) warnings.push("No source-backed email or official contact page was found.");

    normalized.push({
      id: crypto.randomUUID(), researchRunId: runId, opportunityClass: candidate.opportunityClass,
      organizationName: candidate.organizationName.trim(), organizationType: candidate.organizationType.trim(),
      organizationWebsite: candidate.organizationWebsite && validatePublicSourceUrl(candidate.organizationWebsite) ? candidate.organizationWebsite : null,
      organizationDomain, city: candidate.city.trim(), region: candidate.region.trim(),
      eventName: candidate.eventName, eventUrl: candidate.eventUrl && validatePublicSourceUrl(candidate.eventUrl) ? candidate.eventUrl : null,
      eventStartDate, eventEndDate: normalizeDate(candidate.eventEndDate), eventOrganizer: candidate.eventOrganizer,
      contactName: candidate.contactName, contactRole: candidate.contactRole, contactEmail, emailCategory, emailSourceUrl,
      contactPageUrl: candidate.contactPageUrl && validatePublicSourceUrl(candidate.contactPageUrl) ? candidate.contactPageUrl : null,
      recommendedAction: candidate.recommendedAction.trim(), fitExplanation: candidate.fitExplanation.trim(), evidenceSummary: candidate.evidenceSummary.trim(),
      confidence: candidate.opportunityClass === "event" && eventStartDate && eventStartDate < new Date().toISOString().slice(0, 10) ? "low" : contactEmail && sources.length >= 2 ? candidate.confidence : candidate.confidence === "high" ? "medium" : candidate.confidence,
      verificationStatus, warnings, researchedAt: new Date().toISOString(), reviewStatus: "unreviewed", selected: false, userEdits: {}, sources
    });
  }
  return deduplicateLeads(normalized);
}

function normalizeProviderCandidate(candidate: z.infer<typeof LeadCandidateSchema>) {
  const clean = (value: string) => value.trim().replace(/^(?:>\s*)+/, "").trim();
  const cleanNullable = (value: string | null) => {
    if (value === null) return null;
    const cleaned = clean(value);
    return /^(?:null|none|n\/a)$/i.test(cleaned) ? null : cleaned;
  };
  const cleanUrl = (value: string) => {
    const cleaned = clean(value);
    try {
      const url = new URL(cleaned);
      url.hash = "";
      return url.toString();
    } catch {
      return cleaned;
    }
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
    const domainKey = lead.organizationDomain ? `domain:${lead.organizationDomain}:${normalizeOrganizationName(lead.eventName || "")}` : null;
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
  return {
    ...primary,
    contactEmail: primary.contactEmail || duplicate.contactEmail,
    emailSourceUrl: primary.emailSourceUrl || duplicate.emailSourceUrl,
    contactPageUrl: primary.contactPageUrl || duplicate.contactPageUrl,
    contactName: primary.contactName || duplicate.contactName,
    contactRole: primary.contactRole || duplicate.contactRole,
    confidence: confidenceOrder[duplicate.confidence] > confidenceOrder[primary.confidence] ? duplicate.confidence : primary.confidence,
    warnings: Array.from(new Set([...primary.warnings, ...duplicate.warnings, `Merged duplicate record ${duplicate.id}.`])),
    sources: Array.from(sourceMap.values())
  };
}
