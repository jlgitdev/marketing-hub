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

  it("computes summit-sales priority independently from model confidence and verification labels", () => {
    const bundle = demoResearchBundle();
    bundle.leads = bundle.leads.slice(0, 1);
    bundle.leads[0].verificationStatus = "requires_review";
    bundle.leads[0].confidence = "low";

    const [lead] = validateAndNormalizeLeads(bundle, crypto.randomUUID());

    expect(lead.verificationStatus).toBe("source_backed");
    expect(lead.priorityScore).toBe(92);
    expect(lead.priorityTier).toBe("hot");
    expect(lead.qualification.scoreBreakdown).toMatchObject({ audienceFit: 25, distribution: 15, contactability: 15 });
  });

  it("never labels a contact-page-only record source-backed just because the model did", () => {
    const bundle = demoResearchBundle();
    bundle.leads = bundle.leads.slice(1, 2);
    bundle.leads[0].verificationStatus = "source_backed";

    const [lead] = validateAndNormalizeLeads(bundle, crypto.randomUUID());

    expect(lead.contactEmail).toBeNull();
    expect(lead.verificationStatus).toBe("contact_page_only");
  });

  it("removes a contact page that is not backed by an accepted official source", () => {
    const bundle = demoResearchBundle();
    bundle.leads = bundle.leads.slice(1, 2);
    bundle.leads[0].contactPageUrl = "https://invented.example/contact";

    const [lead] = validateAndNormalizeLeads(bundle, crypto.randomUUID());

    expect(lead.contactPageUrl).toBeNull();
    expect(lead.verificationStatus).toBe("requires_review");
    expect(lead.qualification.scoreBreakdown.contactability).toBeLessThan(9);
    expect(lead.warnings.join(" ")).toMatch(/contact page was removed/);
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
    bundle.leads = bundle.leads.slice(0, 4);
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

  it("normalizes serialized null fragments and removes observed sources for a different organization", () => {
    const bundle = demoResearchBundle();
    bundle.leads = bundle.leads.slice(0, 1);
    bundle.leads[0].eventName = ":null,";
    bundle.leads[0].eventOrganizer = "\"null\"";
    bundle.leads[0].contactName = "{null}";
    bundle.leads[0].qualificationSignals.audienceSizeLabel = ":null,";
    bundle.leads[0].supportingSources.push({
      title: "Unrelated robotics association",
      url: "https://unrelated-robotics.example/members",
      sourceType: "official",
      claim: "Describes an unrelated robotics membership organization.",
      accessedAt: new Date().toISOString()
    });

    const [lead] = validateAndNormalizeLeads(bundle, crypto.randomUUID());

    expect(lead.eventName).toBeNull();
    expect(lead.eventOrganizer).toBeNull();
    expect(lead.contactName).toBeNull();
    expect(lead.qualification.audienceSizeLabel).toBeNull();
    expect(lead.sources.some((source) => source.url.includes("unrelated-robotics"))).toBe(false);
    expect(lead.warnings.join(" ")).toMatch(/observed source was removed/);
  });

  it("does not treat every page on a multi-tenant community platform as the same organization", () => {
    const bundle = demoResearchBundle();
    bundle.leads = bundle.leads.slice(0, 1);
    const candidate = bundle.leads[0];
    candidate.organizationName = "Target AI Professionals";
    candidate.organizationWebsite = "https://www.meetup.com/target-ai-professionals";
    candidate.contactEmail = null;
    candidate.emailCategory = "none";
    candidate.emailSourceUrl = null;
    candidate.contactPageUrl = "https://www.meetup.com/target-ai-professionals";
    candidate.supportingSources = [{
      title: "Target AI Professionals",
      url: "https://www.meetup.com/target-ai-professionals",
      sourceType: "official",
      claim: "Official Target AI Professionals group page.",
      accessedAt: new Date().toISOString()
    }, {
      title: "Unrelated Robotics Group",
      url: "https://www.meetup.com/unrelated-robotics-group",
      sourceType: "official",
      claim: "Official page for a separate robotics community.",
      accessedAt: new Date().toISOString()
    }];

    const [lead] = validateAndNormalizeLeads(bundle, crypto.randomUUID());

    expect(lead.sources.map((source) => source.url)).toEqual(["https://www.meetup.com/target-ai-professionals"]);
    expect(lead.warnings.join(" ")).toMatch(/observed source was removed/);
  });

  it("does not merge distinct organizations merely because both are hosted on Meetup", () => {
    const bundle = demoResearchBundle();
    const first = bundle.leads[0];
    first.organizationName = "Target AI Professionals";
    first.organizationWebsite = "https://www.meetup.com/target-ai-professionals";
    first.contactEmail = null;
    first.emailCategory = "none";
    first.emailSourceUrl = null;
    first.contactPageUrl = "https://www.meetup.com/target-ai-professionals";
    first.supportingSources = [{ title: "Target AI Professionals", url: first.contactPageUrl, sourceType: "official", claim: "Official Target AI Professionals group page.", accessedAt: new Date().toISOString() }];
    const second = structuredClone(first);
    second.organizationName = "SF Data Engineering";
    second.organizationWebsite = "https://www.meetup.com/sf-data-engineering";
    second.contactPageUrl = "https://www.meetup.com/sf-data-engineering";
    second.supportingSources = [{ title: "SF Data Engineering", url: second.contactPageUrl, sourceType: "official", claim: "Official SF Data Engineering group page.", accessedAt: new Date().toISOString() }];
    bundle.leads = [first, second];

    const leads = validateAndNormalizeLeads(bundle, crypto.randomUUID());

    expect(leads).toHaveLength(2);
    expect(new Set(leads.map((lead) => lead.canonicalKey)).size).toBe(2);
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

  it("keeps the stronger lead's segment and sales motion and recomputes its score after merging evidence", () => {
    const leads = validateAndNormalizeLeads(demoResearchBundle(), crypto.randomUUID());
    const primary = leads.find((lead) => lead.organizationName === "Aperture Learning Lab")!;
    const stronger = leads.find((lead) => lead.organizationName === "Northstar Systems Learning Council")!;
    const duplicate: LeadRecord = { ...stronger, id: crypto.randomUUID(), organizationName: primary.organizationName, organizationDomain: primary.organizationDomain, canonicalKey: primary.canonicalKey };

    const merged = mergeLeads(primary, duplicate);

    expect(merged.targetSegment).toBe(stronger.targetSegment);
    expect(merged.salesMotion).toBe(stronger.salesMotion);
    expect(merged.qualification.scoreBreakdown.revenuePotential).toBe(stronger.qualification.scoreBreakdown.revenuePotential);
    expect(merged.priorityScore).toBeGreaterThanOrEqual(stronger.priorityScore);
  });
});
