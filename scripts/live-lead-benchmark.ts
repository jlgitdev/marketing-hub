export {};

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error("OPENAI_API_KEY is required in .env.local for the live lead benchmark.");
if (process.env.MARKETING_HUB_DEMO_MODE === "true") throw new Error("Set MARKETING_HUB_DEMO_MODE=false before running the live lead benchmark.");
const liveApiKey = apiKey;

const requestedCount = 5;

async function main() {
  process.env.MARKETING_HUB_DATA_DIR = ".marketing-hub-benchmark";
  const [{ closeDatabase }, { createContextDocument, resetAllData }, { runResearch }] = await Promise.all([
    import("../src/server/db/database"),
    import("../src/server/db/repository"),
    import("../src/server/services/research-service")
  ]);
  const startedAt = Date.now();
  try {
  resetAllData();
  const benchmarkContext = createContextDocument({
    title: "Generic summit benchmark brief",
    type: "event_brief",
    body: "An in-person San Francisco Bay Area AI summit for AI builders, technology professionals, founders, educators, and advanced students. The commercial goal is individual ticket sales, group attendance, employer-funded professional development, and relevant audience distribution. No event name, date, price, customer, partner, or internal organization information is supplied in this benchmark.",
    active: true,
    sourceOfTruth: true,
    notes: "Synthetic, non-private context used only by the isolated live lead benchmark.",
    summary: "Synthetic Bay Area AI summit audience and commercial goals.",
    tags: ["benchmark", "AI summit", "Bay Area"],
    platforms: [],
    purposes: ["research"],
    origin: "demo",
    sourcePath: null,
    contentHash: null
  });
  const result = await runResearch({
    name: `Live summit lead benchmark ${new Date().toISOString().slice(0, 10)}`,
    objective: "Find novel San Francisco Bay Area prospects that can buy AI summit tickets, fund multiple employee or student tickets, or distribute a summit invitation to a qualified local audience. Favor actionable near-term revenue paths over generic awareness.",
    region: "San Francisco Bay Area",
    count: requestedCount,
    contextMode: "manual",
    contextDocumentIds: [benchmarkContext.id],
    opportunityTypes: ["organization", "event"],
    organizationCategories: ["technology employers", "AI professional communities", "college-prep organizations", "universities", "STEM education programs", "startup and founder communities"],
    eventCategories: ["AI conferences", "technology meetups", "education and STEM events", "founder events"],
    targetRoles: ["learning and development", "engineering leadership", "partnerships", "community", "programs", "education"],
    audienceRoles: ["AI professionals", "technology employees", "founders", "educators", "advanced students"],
    targetSegments: ["ai_professionals", "technology_employees", "founders_operators", "college_prep_education", "educators"],
    salesMotions: ["direct_ticket_sales", "group_ticket_sales", "employer_learning_budget", "education_distribution", "partner_distribution", "cross_promotion"],
    minimumPriorityScore: 50,
    excludePreviouslyResearched: true,
    positiveKeywords: "AI, machine learning, professional development, engineering, STEM, innovation",
    exclusionKeywords: "inactive, closed, unrelated consumer offer, vendor without relevant audience",
    dateRange: `${new Date().toISOString().slice(0, 10)} through 2027-01-31`,
    notes: "Benchmark run: prefer an official public decision-maker email or contact page and a concrete ticket, group-purchase, or distribution next action."
  }, liveApiKey);

  const leads = result.leads;
  const contactable = leads.filter((lead) => lead.contactEmail || lead.contactPageUrl);
  const sourceBackedEmails = leads.filter((lead) => lead.contactEmail && lead.verificationStatus === "source_backed");
  const salesReady = leads.filter((lead) => lead.priorityScore >= 65);
  const uniqueKeys = new Set(leads.map((lead) => lead.canonicalKey));
  const representedSegments = new Set(leads.map((lead) => lead.targetSegment));
  const representedMotions = new Set(leads.map((lead) => lead.salesMotion));
  const minimumReturned = Math.min(requestedCount, 4);
  const checks = {
    qualifiedYield: leads.length >= minimumReturned,
    evidenceCoverage: leads.every((lead) => lead.sources.length > 0),
    uniqueIdentity: uniqueKeys.size === leads.length,
    contactability: contactable.length / Math.max(1, leads.length) >= 0.6,
    segmentDiversity: representedSegments.size >= Math.min(3, leads.length),
    salesMotionDiversity: representedMotions.size >= Math.min(3, leads.length),
    salesReadiness: salesReady.length / Math.max(1, leads.length) >= 0.6
  };

  const report = {
    runId: result.run.id,
    status: result.run.status,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    requested: requestedCount,
    returned: leads.length,
    contactable: contactable.length,
    sourceBackedEmails: sourceBackedEmails.length,
    salesReady: salesReady.length,
    segments: [...representedSegments],
    salesMotions: [...representedMotions],
    checks,
    warnings: result.run.warnings,
    leads: leads.map((lead) => ({
      organization: lead.organizationName,
      opportunity: lead.eventName || lead.organizationName,
      segment: lead.targetSegment,
      salesMotion: lead.salesMotion,
      score: lead.priorityScore,
      tier: lead.priorityTier,
      contactPath: lead.verificationStatus,
      sourceCount: lead.sources.length,
      nextBestAction: lead.nextBestAction
    }))
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (Object.values(checks).some((passed) => !passed)) {
    process.exitCode = 1;
    process.stderr.write("Live summit lead benchmark did not satisfy every quality threshold.\n");
  }
  } finally {
    closeDatabase();
  }
}

void main().catch((error) => {
  process.exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.message : "Live summit lead benchmark failed."}\n`);
});
