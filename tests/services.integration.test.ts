import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createContextDocument, deleteContextDocument, listContentCampaigns, listContextDocuments, listLeads, listResearchRuns, resetAllData, updateContextDocument, updateLead, updateOutreachRecipient, updatePlatformPost } from "@/server/db/repository";
import { DEMO_CONTEXT } from "@/server/ai/demo-provider";
import { runResearch } from "@/server/services/research-service";
import { generateOutreach } from "@/server/services/outreach-service";
import { leadsCsv, outreachCsv, substituteMergeFields, unresolvedPlaceholders } from "@/server/services/export-service";
import { generateContentCampaign, regeneratePlatform } from "@/server/services/content-service";
import { generateCampaignGraphic } from "@/server/storage/assets";
import { closeDatabase, getDatabase } from "@/server/db/database";
import { dataDirectory } from "@/server/config";

beforeEach(() => resetAllData());
afterAll(() => closeDatabase());

function seedContext() { return DEMO_CONTEXT.map((document) => createContextDocument(document)); }

describe("deterministic persisted workflows", () => {
  it("recreates every writable asset directory after a full local reset", () => {
    for (const name of ["uploads", "generated", "exports", "tmp"]) expect(fs.statSync(path.join(dataDirectory(), name)).isDirectory()).toBe(true);
  });

  it("creates, edits, enables, and deletes local context", () => {
    const document = createContextDocument(DEMO_CONTEXT[0]);
    updateContextDocument(document.id, { title: "Updated event brief", active: false });
    expect(listContextDocuments()[0]).toMatchObject({ title: "Updated event brief", active: false });
    deleteContextDocument(document.id);
    expect(listContextDocuments()).toHaveLength(0);
  });

  it("reopens persisted records after the database process handle is restarted", () => {
    const document = createContextDocument(DEMO_CONTEXT[0]);
    closeDatabase();
    getDatabase();
    expect(listContextDocuments().find((item) => item.id === document.id)?.title).toBe(document.title);
  });
  it("uploads/saves context and completes a source-preserving mocked research run", async () => {
    const context = seedContext();
    const result = await runResearch({ name: "Test Bay scan", objective: "Find fictional source-backed AI event opportunities", region: "San Francisco Bay Area", count: 10, contextDocumentIds: context.map((item) => item.id), opportunityTypes: ["organization", "event"], organizationCategories: ["education", "AI community"], eventCategories: ["AI events"], targetRoles: ["partnerships"], audienceRoles: ["builders"], positiveKeywords: "AI", exclusionKeywords: "", dateRange: "", notes: "" }, null);
    expect(result.run.status).toBe("partially_completed");
    expect(listResearchRuns()).toHaveLength(1);
    expect(listLeads().length).toBeGreaterThanOrEqual(3);
    expect(listLeads().every((lead) => lead.sources.length > 0)).toBe(true);
    expect(listLeads().find((lead) => lead.contactPageUrl && !lead.contactEmail)).toBeTruthy();
    expect(listLeads().every((lead) => lead.priorityScore >= 45 && lead.canonicalKey.length > 0)).toBe(true);
    expect(listLeads()[0].qualification.scoreBreakdown.audienceFit).toBeGreaterThan(0);

    const legacyLead = listLeads()[0];
    getDatabase().prepare("UPDATE leads SET qualification='{}', priority_score=0, priority_tier='nurture' WHERE id=?").run(legacyLead.id);
    const hydratedLead = listLeads().find((lead) => lead.id === legacyLead.id)!;
    const hydratedScores = Object.values(hydratedLead.qualification.scoreBreakdown);
    expect(hydratedScores.every(Number.isFinite)).toBe(true);
    expect(hydratedLead.priorityScore).toBe(hydratedScores.reduce((total, score) => total + score, 0));
    expect(hydratedLead.priorityScore).toBeGreaterThan(0);
  });

  it("generates editable outreach and exports only reviewed, source-backed recipients", async () => {
    const context = seedContext();
    await runResearch({ name: "Outreach scan", objective: "Find fictional partners for review and outreach", region: "San Francisco Bay Area", count: 10, contextDocumentIds: context.map((item) => item.id), opportunityTypes: ["organization", "event"], organizationCategories: ["AI community"], eventCategories: ["AI events"], targetRoles: ["partnerships"], audienceRoles: ["builders"], positiveKeywords: "AI", exclusionKeywords: "", dateRange: "", notes: "" }, null);
    const lead = listLeads().find((item) => item.contactEmail && item.verificationStatus === "source_backed")!;
    updateLead(lead.id, { selected: true, reviewStatus: "reviewed" });
    const campaign = await generateOutreach({ name: "Partner outreach", mode: "partner_share", leadIds: [lead.id], contextDocumentIds: context.map((item) => item.id), instructions: "" }, null);
    updateOutreachRecipient(campaign.recipients[0].id, { body: "Edited, reviewed body", reviewStatus: "reviewed" });
    const csv = outreachCsv(campaign.id);
    expect(csv).toContain("Edited, reviewed body");
    expect(csv).toContain(lead.emailSourceUrl!);
    expect(csv).not.toContain("undefined");
  });

  it("exports selected sales intelligence in priority order without exposing unverified emails", async () => {
    const context = seedContext();
    await runResearch({ name: "Lead export scan", objective: "Find fictional partners for a direct sales data export", region: "San Francisco Bay Area", count: 10, contextDocumentIds: context.map((item) => item.id) }, null);
    const leads = listLeads().sort((a, b) => b.priorityScore - a.priorityScore);
    updateLead(leads[0].id, { selected: true });
    const unverified = leads.find((lead) => lead.verificationStatus !== "source_backed" && lead.contactEmail);
    if (unverified) updateLead(unverified.id, { selected: true });

    const csv = leadsCsv({ selectedOnly: true });

    expect(csv).toContain("priority_score");
    expect(csv).toContain("next_best_action");
    expect(csv).toContain(leads[0].organizationName);
    if (unverified?.contactEmail) expect(csv).not.toContain(unverified.contactEmail);
  });

  it("never promotes a user-edited unsourced email into outreach or CSV export", async () => {
    const context = seedContext();
    await runResearch({ name: "Unsourced edit scan", objective: "Find fictional partners and test the source boundary", region: "San Francisco Bay Area", count: 10, contextDocumentIds: context.map((item) => item.id), opportunityTypes: ["organization"], organizationCategories: ["AI community"], eventCategories: [], targetRoles: ["partnerships"], audienceRoles: ["builders"], positiveKeywords: "AI", exclusionKeywords: "", dateRange: "", notes: "" }, null);
    const lead = listLeads().find((item) => item.contactEmail && item.verificationStatus === "source_backed")!;
    updateLead(lead.id, { contactEmail: "manual@example.com", emailCategory: "none", emailSourceUrl: null, verificationStatus: "requires_review", selected: true, reviewStatus: "needs_review" });
    const campaign = await generateOutreach({ name: "Unsourced boundary", mode: "partner_share", leadIds: [lead.id], contextDocumentIds: context.map((item) => item.id), instructions: "" }, null);
    expect(campaign.recipients[0].email).toBeNull();
    updateOutreachRecipient(campaign.recipients[0].id, { reviewStatus: "reviewed" });
    expect(() => outreachCsv(campaign.id)).toThrow(/source-backed email/);
  });

  it("generates all platform outputs, regenerates one, and survives an image render", async () => {
    const context = seedContext();
    const campaign = await generateContentCampaign({ name: "Social launch", brief: "Introduce the fictional event with practical platform-specific writing", objective: "Registrations", audience: "AI builders", callToAction: "Explore the program", requiredPhrases: "", prohibitedPhrases: "", headline: "Applied Intelligence Forum", imageDirection: "Cobalt editorial visual", contextDocumentIds: context.map((item) => item.id), platforms: ["x", "linkedin", "instagram"] }, null);
    expect(new Set(campaign.posts.map((post) => post.text)).size).toBe(3);
    updatePlatformPost(campaign.posts[1].id, { hook: "Edited campaign hook", callToAction: "Edited call to action" });
    expect(listContentCampaigns()[0].posts.find((post) => post.id === campaign.posts[1].id)).toMatchObject({ hook: "Edited campaign hook", callToAction: "Edited call to action" });
    const regenerated = await regeneratePlatform(campaign.id, "x", null);
    expect(regenerated.version).toBe(2);
    const asset = await generateCampaignGraphic({ campaignId: campaign.id, platform: "instagram", prompt: campaign.posts[2].imagePrompt, headline: "Applied Intelligence Forum", subheadline: "October 14 · San Francisco", footer: "forum.example/tickets", apiKey: null });
    expect(asset.mimeType).toBe("image/png");
    expect(listContentCampaigns()[0].assets.some((item) => item.id === asset.id)).toBe(true);
  });

  it("deterministically labels fallback style when no platform guide is selected", async () => {
    const eventBrief = createContextDocument(DEMO_CONTEXT.find((document) => document.type === "event_brief")!);
    const campaign = await generateContentCampaign({ name: "Fallback style", brief: "Create a restrained fictional post without a selected platform guide", objective: "Awareness", audience: "Builders", callToAction: "Learn more", contextDocumentIds: [eventBrief.id], platforms: ["x"] }, null);
    expect(campaign.posts[0]).toMatchObject({ styleGuideStatus: "fallback", warnings: expect.arrayContaining([expect.stringMatching(/fallback style/)]) });
  });

  it("keeps failed provider runs inspectable and preserves content when image generation fails", async () => {
    const context = seedContext();
    await expect(runResearch({ name: "Failed fixture", objective: "Find opportunities [demo-provider-error]", region: "San Francisco Bay Area", count: 5, contextDocumentIds: context.map((item) => item.id) }, null)).rejects.toThrow(/demo provider error/);
    expect(listResearchRuns()[0].status).toBe("failed");
    const campaign = await generateContentCampaign({ name: "Preserved text", brief: "Create a complete fictional campaign that survives an image provider error", objective: "Registrations", audience: "Builders", callToAction: "Learn more", contextDocumentIds: context.map((item) => item.id), platforms: ["instagram"] }, null);
    await expect(generateCampaignGraphic({ campaignId: campaign.id, platform: "instagram", prompt: "[demo-image-error]", headline: "Headline", subheadline: "Subheadline", footer: "CTA", apiKey: null })).rejects.toThrow(/image-generation error/);
    expect(listContentCampaigns()[0].posts).toHaveLength(1);
    expect(listContentCampaigns()[0].assets).toHaveLength(0);
  });

  it("persists a failed content text run without replacing a prior successful campaign", async () => {
    const context = seedContext();
    await generateContentCampaign({ name: "Successful predecessor", brief: "Create a complete fictional campaign before the controlled failure", objective: "Registrations", audience: "Builders", callToAction: "Learn more", contextDocumentIds: context.map((item) => item.id), platforms: ["linkedin"] }, null);
    await expect(generateContentCampaign({ name: "Inspectable failure", brief: "Trigger and preserve this controlled run [demo-provider-error]", objective: "Registrations", audience: "Builders", callToAction: "Learn more", contextDocumentIds: context.map((item) => item.id), platforms: ["linkedin"] }, null)).rejects.toThrow(/demo provider error/);
    const campaigns = listContentCampaigns();
    expect(campaigns.find((item) => item.name === "Inspectable failure")).toMatchObject({ status: "failed", posts: [], error: expect.stringMatching(/demo provider error/) });
    expect(campaigns.find((item) => item.name === "Successful predecessor")).toMatchObject({ status: "completed" });
  });
});

describe("merge fields", () => {
  it("substitutes known fields and reports unresolved placeholders", () => {
    const result = substituteMergeFields("Hi {{contact_name}}, join {{event_name}} at {{event_location}}.", { contact_name: "Jordan", event_name: "Forum" });
    expect(result).toContain("Hi Jordan");
    expect(unresolvedPlaceholders(result)).toEqual(["event_location"]);
  });
});
