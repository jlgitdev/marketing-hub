import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { demoResearchBundle } from "@/server/ai/demo-provider";
import { validateAndNormalizeLeads } from "@/server/services/lead-validation";
import { prioritizeNovelLeads } from "@/server/services/lead-qualification";

describe("summit sales lead qualification", () => {
  it("ranks revenue and distribution opportunities ahead of weaker records", () => {
    const leads = validateAndNormalizeLeads(demoResearchBundle(), crypto.randomUUID());
    const ranked = prioritizeNovelLeads(leads, [], 10);

    expect(ranked[0].organizationName).toBe("Bay Circuit AI Community");
    expect(ranked[0].priorityTier).toBe("hot");
    expect(ranked.find((lead) => lead.organizationName === "Northstar Systems Learning Council")?.priorityScore).toBeGreaterThan(80);
    expect(ranked.at(-1)?.priorityScore).toBeLessThan(ranked[0].priorityScore);
  });

  it("suppresses canonical identities already saved in a prior run", () => {
    const firstRun = validateAndNormalizeLeads(demoResearchBundle(), crypto.randomUUID());
    const secondRun = validateAndNormalizeLeads(demoResearchBundle(), crypto.randomUUID());

    expect(prioritizeNovelLeads(secondRun, firstRun, 10)).toHaveLength(0);
  });

  it("suppresses the same organization across runs when its website hostname changes", () => {
    const [existing] = validateAndNormalizeLeads(demoResearchBundle(), crypto.randomUUID());
    const candidate = { ...existing, id: crypto.randomUUID(), organizationDomain: "community.baycircuit.example", canonicalKey: "community.baycircuit.example:organization" };

    expect(prioritizeNovelLeads([candidate], [existing], 10)).toHaveLength(0);
  });
});
