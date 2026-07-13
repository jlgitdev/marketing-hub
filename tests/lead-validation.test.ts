import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LeadRecord } from "@/lib/types";
import { demoResearchBundle } from "@/server/ai/demo-provider";
import { mergeLeads, validateAndNormalizeLeads } from "@/server/services/lead-validation";

describe("structured lead parsing and evidence enforcement", () => {
  it("removes an email without the exact source URL but preserves a contact-page-only lead", () => {
    const bundle = demoResearchBundle();
    bundle.leads = bundle.leads.slice(0, 1);
    bundle.leads[0].emailSourceUrl = "https://not-in-sources.example/contact";
    const leads = validateAndNormalizeLeads(bundle, crypto.randomUUID());
    const lead = leads.find((item) => item.organizationName === "Bay Circuit AI Community");
    expect(lead?.contactEmail).toBeNull();
    expect(lead?.contactPageUrl).toBe("https://baycircuit.example/contact");
    expect(lead?.warnings.join(" ")).toMatch(/removed/);
  });

  it("keeps exact source-backed role email and flags a consumer-domain third-party email", () => {
    const leads = validateAndNormalizeLeads(demoResearchBundle(), crypto.randomUUID());
    const official = leads.find((item) => item.organizationName === "Bay Circuit AI Community");
    const consumer = leads.find((item) => item.organizationName === "Aperture Learning Lab");
    expect(official?.contactEmail).toBe("partnerships@baycircuit.example");
    expect(official?.verificationStatus).toBe("source_backed");
    expect(consumer?.verificationStatus).toBe("requires_review");
    expect(consumer?.warnings.join(" ")).toMatch(/Consumer-domain/);
  });

  it("preserves provider citation metadata on accepted supporting sources", () => {
    const bundle = demoResearchBundle();
    const metadata = new Map(bundle.leads.flatMap((lead) => lead.supportingSources).map((source) => [source.url, { annotations: [{ type: "url_citation", url: source.url, start_index: 1, end_index: 4 }] }]));
    const leads = validateAndNormalizeLeads(bundle, crypto.randomUUID(), metadata);
    expect((leads[0].sources[0].citationMetadata?.annotations as unknown[]).length).toBeGreaterThan(0);
  });

  it("does not save a provider result when none of its claimed sources were observed", () => {
    const bundle = demoResearchBundle();
    bundle.leads = bundle.leads.slice(0, 1);
    const metadata = new Map([["https://different.example/observed", { observed: true }]]);

    expect(validateAndNormalizeLeads(bundle, crypto.randomUUID(), metadata)).toHaveLength(0);
  });

  it("deduplicates by normalized email/domain and preserves every source and warning", () => {
    const leads = validateAndNormalizeLeads(demoResearchBundle(), crypto.randomUUID());
    expect(leads.filter((item) => item.organizationName === "Bay Circuit AI Community")).toHaveLength(1);
    const merged = leads.find((item) => item.organizationName === "Bay Circuit AI Community");
    expect(merged?.sources.map((source) => source.url)).toContain("https://baycircuit.example/about");
    expect(merged?.warnings.join(" ")).toMatch(/Merged duplicate/);
  });

  it("normalizes dates and warns when a professional email domain differs from the organization", () => {
    const bundle = demoResearchBundle();
    const organization = bundle.leads[0];
    organization.contactEmail = "partnerships@different.example";
    organization.supportingSources.find((source) => source.url === organization.emailSourceUrl)!.claim = "Publishes partnerships@different.example for partnership requests.";
    const event = bundle.leads.find((lead) => lead.opportunityClass === "event")!;
    event.eventStartDate = "not-a-date";
    const leads = validateAndNormalizeLeads(bundle, crypto.randomUUID());
    const normalizedOrganization = leads.find((lead) => lead.organizationName === organization.organizationName)!;
    const normalizedEvent = leads.find((lead) => lead.opportunityClass === "event")!;
    expect(normalizedOrganization.verificationStatus).toBe("requires_review");
    expect(normalizedOrganization.warnings.join(" ")).toMatch(/differs from the organization/);
    expect(normalizedEvent.eventStartDate).toBeNull();
  });

  it("removes provider blockquote artifacts before validating evidence and nullable fields", () => {
    const bundle = demoResearchBundle();
    bundle.leads = bundle.leads.slice(0, 1);
    const candidate = bundle.leads[0];
    candidate.organizationName = `>${candidate.organizationName}`;
    candidate.organizationWebsite = `>${candidate.organizationWebsite}`;
    candidate.contactName = ">null";
    candidate.eventStartDate = ">2026-07-18";
    candidate.supportingSources = candidate.supportingSources.map((source) => ({
      ...source,
      title: `>${source.title}`,
      url: `>${source.url}`,
      claim: `>${source.claim}`
    }));
    const metadata = new Map(candidate.supportingSources.map((source) => [new URL(source.url.slice(1)).toString(), { observed: true }]));

    const [lead] = validateAndNormalizeLeads(bundle, crypto.randomUUID(), metadata);

    expect(lead.organizationName.startsWith(">" )).toBe(false);
    expect(lead.contactName).toBeNull();
    expect(lead.eventStartDate).toBe("2026-07-18");
    expect(lead.sources.length).toBeGreaterThan(0);
    expect(lead.sources.every((source) => !source.url.startsWith(">"))).toBe(true);
  });
});

describe("manual duplicate merge", () => {
  it("keeps stronger confidence and non-conflicting evidence", () => {
    const [primary] = validateAndNormalizeLeads(demoResearchBundle(), crypto.randomUUID());
    const duplicate: LeadRecord = { ...primary, id: crypto.randomUUID(), confidence: "low", contactName: "Example Person", sources: [{ title: "Extra", url: "https://baycircuit.example/extra", sourceType: "official", claim: "Extra claim", accessedAt: new Date().toISOString() }] };
    const merged = mergeLeads(primary, duplicate);
    expect(merged.confidence).toBe("high");
    expect(merged.sources).toHaveLength(primary.sources.length + 1);
  });
});
