import type { LeadPriorityTier, LeadQualification, LeadRecord, LeadSalesMotion } from "@/lib/types";
import { isMultiTenantPlatformDomain, normalizeEmail, normalizeOrganizationName } from "@/server/security/validation";

type QualificationSignals = Omit<LeadQualification, "scoreBreakdown">;

const AUDIENCE_POINTS = { weak: 4, moderate: 12, strong: 20, exact: 25 } as const;
const BUYING_POINTS = { none: 0, weak: 5, moderate: 12, strong: 18 } as const;
const DISTRIBUTION_POINTS = { none: 0, limited: 5, moderate: 10, high: 15 } as const;
const LOCAL_POINTS = { none: 0, adjacent: 4, local: 10 } as const;
const TIMING_POINTS = { poor: 0, neutral: 3, good: 7, urgent: 10 } as const;

const SALES_MOTION_BONUS: Record<LeadSalesMotion, number> = {
  direct_ticket_sales: 2,
  group_ticket_sales: 2,
  partner_distribution: 0,
  employer_learning_budget: 2,
  education_distribution: 1,
  cross_promotion: 0,
  sponsorship: 2
};

export function canonicalLeadKey(input: Pick<LeadRecord, "organizationDomain" | "organizationName" | "opportunityClass" | "eventName">) {
  const organization = input.organizationDomain && !isMultiTenantPlatformDomain(input.organizationDomain) ? input.organizationDomain : normalizeOrganizationName(input.organizationName);
  const event = input.opportunityClass === "event" ? normalizeOrganizationName(input.eventName || "unnamed event") : "organization";
  return `${organization}:${event}`;
}

export function leadIdentityKeys(input: Pick<LeadRecord, "organizationDomain" | "organizationName" | "opportunityClass" | "eventName" | "contactEmail">) {
  const event = input.opportunityClass === "event" ? normalizeOrganizationName(input.eventName || "unnamed event") : "organization";
  return new Set([
    canonicalLeadKey(input),
    `name:${normalizeOrganizationName(input.organizationName)}:${event}`,
    ...(input.organizationDomain && !isMultiTenantPlatformDomain(input.organizationDomain) ? [`domain:${input.organizationDomain}:${event}`] : []),
    ...(input.contactEmail ? [`email:${normalizeEmail(input.contactEmail)}`] : [])
  ]);
}

export function qualifyLead(
  lead: Pick<LeadRecord, "contactEmail" | "contactPageUrl" | "contactName" | "contactRole" | "verificationStatus" | "sources"> & { salesMotion: LeadSalesMotion },
  signals: QualificationSignals
): { priorityScore: number; priorityTier: LeadPriorityTier; qualification: LeadQualification } {
  const audienceFit = AUDIENCE_POINTS[signals.audienceFit];
  const revenuePotential = Math.min(20, BUYING_POINTS[signals.buyingSignal] + SALES_MOTION_BONUS[lead.salesMotion]);
  const distribution = DISTRIBUTION_POINTS[signals.distributionPotential];
  const localRelevance = LOCAL_POINTS[signals.localRelevance];
  const timing = TIMING_POINTS[signals.timingFit];

  let contactability = 0;
  if (lead.contactEmail && lead.verificationStatus === "source_backed") contactability = 15;
  else if (lead.contactEmail) contactability = 8;
  else if (lead.contactPageUrl) contactability = 9;
  else if (lead.contactName || lead.contactRole) contactability = 4;
  if (signals.decisionMakerAccess === "decision_maker") contactability = Math.min(15, contactability + 3);
  else if (signals.decisionMakerAccess === "influencer") contactability = Math.min(15, contactability + 1);

  const officialSources = lead.sources.filter((source) => source.sourceType === "official" || source.sourceType === "event").length;
  const evidenceQuality = Math.min(5, officialSources * 2 + (lead.sources.length >= 2 ? 1 : 0));
  const scoreBreakdown = { audienceFit, revenuePotential, distribution, contactability, localRelevance, timing, evidenceQuality };
  const priorityScore = Object.values(scoreBreakdown).reduce((sum, score) => sum + score, 0);
  const priorityTier: LeadPriorityTier = priorityScore >= 80 ? "hot" : priorityScore >= 65 ? "strong" : priorityScore >= 50 ? "promising" : "nurture";

  return { priorityScore, priorityTier, qualification: { ...signals, scoreBreakdown } };
}

export function prioritizeNovelLeads(leads: LeadRecord[], existing: LeadRecord[], count: number) {
  const existingKeys = new Set(existing.flatMap((lead) => [...leadIdentityKeys(lead)]));
  return leads
    .filter((lead) => [...leadIdentityKeys(lead)].every((key) => !existingKeys.has(key)))
    .sort((a, b) => b.priorityScore - a.priorityScore || Number(Boolean(b.contactEmail)) - Number(Boolean(a.contactEmail)) || b.sources.length - a.sources.length)
    .slice(0, count);
}
