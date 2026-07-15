import { listLeads, listOutreachCampaigns } from "@/server/db/repository";
import { escapeCsvCell } from "@/server/security/validation";

export const MERGE_FIELDS = ["contact_first_name", "contact_name", "contact_role", "organization_name", "event_name", "event_date", "event_location", "ticket_url"] as const;

export function substituteMergeFields(template: string, values: Record<string, string | null | undefined>) {
  return template.replace(/{{([a-z_]+)}}/g, (match, field) => values[field] ?? match);
}

export function unresolvedPlaceholders(value: string) {
  return Array.from(value.matchAll(/{{([a-z_]+)}}|\[NEEDS ([^\]]+)\]/g)).map((match) => match[1] || match[2]);
}

export function outreachCsv(campaignId: string) {
  const campaign = listOutreachCampaigns().find((item) => item.id === campaignId);
  if (!campaign) throw new Error("Outreach campaign not found.");
  const leads = new Map(listLeads().map((lead) => [lead.id, lead]));
  const recipients = campaign.recipients.filter((recipient) => {
    const lead = leads.get(recipient.leadId);
    return recipient.reviewStatus === "reviewed" && !recipient.excluded && Boolean(
      recipient.email &&
      lead?.contactEmail &&
      recipient.email.toLowerCase() === lead.contactEmail.toLowerCase() &&
      lead.verificationStatus === "source_backed" &&
      lead.emailSourceUrl
    );
  });
  if (!recipients.length) throw new Error("Review at least one recipient with a source-backed email before export.");
  const headers = ["recipient_email", "contact_name", "contact_role", "organization", "subject", "message_body", "forwardable_announcement", "source_url", "confidence", "verification_status", "review_status"];
  const rows = recipients.map((recipient) => {
    const lead = leads.get(recipient.leadId);
    return [recipient.email, lead?.contactName, lead?.contactRole, lead?.organizationName, recipient.subject, recipient.body, recipient.forwardableAnnouncement, lead?.emailSourceUrl || lead?.contactPageUrl, lead?.confidence, lead?.verificationStatus, recipient.reviewStatus];
  });
  return `\uFEFF${[headers, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n")}`;
}

export function leadsCsv(input: { runId?: string | null; selectedOnly?: boolean; minimumPriorityScore?: number } = {}) {
  const leads = listLeads()
    .filter((lead) => !input.runId || lead.researchRunId === input.runId)
    .filter((lead) => !input.selectedOnly || lead.selected)
    .filter((lead) => lead.priorityScore >= (input.minimumPriorityScore ?? 0))
    .sort((a, b) => b.priorityScore - a.priorityScore || a.organizationName.localeCompare(b.organizationName));
  if (!leads.length) throw new Error(input.selectedOnly ? "Select at least one lead before exporting lead data." : "No lead data matches this export.");
  const headers = [
    "priority_score", "priority_tier", "target_segment", "sales_motion", "opportunity_type", "organization", "event_name", "event_date",
    "city", "region", "contact_name", "contact_role", "source_backed_email", "contact_page", "verification_status", "evidence_confidence",
    "next_best_action", "sales_angle", "fit_explanation", "evidence_summary", "organization_website", "event_url", "review_status", "last_verified_at",
    "source_urls", "warnings"
  ];
  const rows = leads.map((lead) => [
    lead.priorityScore, lead.priorityTier, lead.targetSegment, lead.salesMotion, lead.opportunityClass, lead.organizationName, lead.eventName, lead.eventStartDate,
    lead.city, lead.region, lead.contactName, lead.contactRole,
    lead.verificationStatus === "source_backed" ? lead.contactEmail : null,
    lead.contactPageUrl, lead.verificationStatus, lead.confidence, lead.nextBestAction || lead.recommendedAction, lead.outreachAngle || lead.recommendedAction,
    lead.fitExplanation, lead.evidenceSummary, lead.organizationWebsite, lead.eventUrl, lead.reviewStatus, lead.lastVerifiedAt,
    lead.sources.map((source) => source.url).join(" | "), lead.warnings.join(" | ")
  ]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n")}`;
}
