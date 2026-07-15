export {};

process.env.MARKETING_HUB_DATA_DIR = ".marketing-hub-benchmark";

async function main() {
  const [{ closeDatabase, getDatabase }, { ResearchBundleSchema }, { collectSourceMetadata }, { validateAndNormalizeLeads }, { prioritizeNovelLeads }] = await Promise.all([
    import("../src/server/db/database"),
    import("../src/server/ai/schemas"),
    import("../src/server/ai/openai-provider"),
    import("../src/server/services/lead-validation"),
    import("../src/server/services/lead-qualification")
  ]);
  try {
    const row = getDatabase().prepare("SELECT id,raw_output FROM research_runs WHERE status='completed' AND raw_output IS NOT NULL ORDER BY started_at DESC LIMIT 1").get() as { id: string; raw_output: string } | undefined;
    if (!row) throw new Error("No completed live lead benchmark with raw output was found.");
    const raw = JSON.parse(row.raw_output) as { enrichment?: unknown[] };
    const batches = Array.isArray(raw.enrichment) ? raw.enrichment : [];
    const leads: unknown[] = [];
    const warnings: string[] = [];
    const sourceMetadata = new Map<string, Record<string, unknown>>();

    for (const batch of batches) {
      if (!Array.isArray(batch)) continue;
      for (const [url, metadata] of collectSourceMetadata(batch)) sourceMetadata.set(url, { ...(sourceMetadata.get(url) || {}), ...metadata });
      for (const item of batch) {
        if (!item || typeof item !== "object" || (item as { type?: unknown }).type !== "message") continue;
        const content = (item as { content?: unknown }).content;
        if (!Array.isArray(content)) continue;
        for (const part of content) {
          if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "output_text" || typeof (part as { text?: unknown }).text !== "string") continue;
          const parsed = ResearchBundleSchema.safeParse(JSON.parse((part as { text: string }).text));
          if (!parsed.success) continue;
          leads.push(...parsed.data.leads);
          warnings.push(...parsed.data.warnings);
        }
      }
    }
    const bundle = ResearchBundleSchema.parse({ leads, warnings: Array.from(new Set(warnings)) });
    const normalized = prioritizeNovelLeads(validateAndNormalizeLeads(bundle, row.id, sourceMetadata), [], 5);
    const contactable = normalized.filter((lead) => lead.contactEmail || lead.contactPageUrl);
    const sourceBackedEmails = normalized.filter((lead) => lead.contactEmail && lead.verificationStatus === "source_backed");
    const segments = new Set(normalized.map((lead) => lead.targetSegment));
    const motions = new Set(normalized.map((lead) => lead.salesMotion));
    const nullArtifacts = normalized.filter((lead) => [lead.eventName, lead.eventOrganizer, lead.contactName, lead.qualification.audienceSizeLabel].some((value) => value && /null/i.test(value)));
    const checks = {
      returnedFive: normalized.length === 5,
      artifactFreeNullableFields: nullArtifacts.length === 0,
      evidenceCoverage: normalized.every((lead) => lead.sources.length > 0),
      contactability: contactable.length === normalized.length,
      sourceBackedEmailCoverage: sourceBackedEmails.length >= 3,
      segmentDiversity: segments.size >= 3,
      salesMotionDiversity: motions.size >= 3,
      salesReadiness: normalized.every((lead) => lead.priorityScore >= 65)
    };
    process.stdout.write(`${JSON.stringify({
      runId: row.id,
      returned: normalized.length,
      contactable: contactable.length,
      sourceBackedEmails: sourceBackedEmails.length,
      segments: [...segments],
      salesMotions: [...motions],
      checks,
      leads: normalized.map((lead) => ({
        organization: lead.organizationName,
        eventName: lead.eventName,
        contactName: lead.contactName,
        score: lead.priorityScore,
        sourceCount: lead.sources.length,
        sourceUrls: lead.sources.map((source) => source.url),
        validationWarnings: lead.warnings.filter((warning) => /source.*removed/i.test(warning))
      }))
    }, null, 2)}\n`);
    if (Object.values(checks).some((passed) => !passed)) throw new Error("Offline revalidation did not satisfy every benchmark threshold.");
  } finally {
    closeDatabase();
  }
}

void main().catch((error) => {
  process.exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.message : "Lead benchmark revalidation failed."}\n`);
});
