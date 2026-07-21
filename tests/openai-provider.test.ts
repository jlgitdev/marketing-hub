import { describe, expect, it } from "vitest";
import {
  OPENAI_IMAGE_TIMEOUT_MS,
  OPENAI_RESEARCH_TIMEOUT_MS,
  OPENAI_TEXT_TIMEOUT_MS,
  buildSpeakerSpotlightImageEditRequest,
  buildSummitAgendaImageEditRequest,
  classifyProviderError,
  collectSourceMetadata,
  parseStructuredResponse,
  planResearchCandidateBatches,
  researchWebSearchTool,
  withOpenAIRequestDeadline
} from "@/server/ai/openai-provider";
import { DiscoveryBundleSchema, type DiscoveryBundle } from "@/server/ai/schemas";

describe("OpenAI provider diagnostics and GPT Image 2 request", () => {
  it("builds a model-correct 2:3 GPT Image 2 edit without input_fidelity", () => {
    const image = [{} as never, {} as never];
    const request = buildSpeakerSpotlightImageEditRequest(image, "Create the verified speaker card");

    expect(request).toMatchObject({
      model: "gpt-image-2",
      image,
      prompt: "Create the verified speaker card",
      size: "1024x1536",
      quality: "high",
      output_format: "png"
    });
    expect(request).not.toHaveProperty("input_fidelity");
    expect(request.image).toHaveLength(2);
    expect(OPENAI_IMAGE_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000);
  });

  it("uses the selected template orientation for GPT Image 2 edits", () => {
    const image = [{} as never, {} as never];
    expect(buildSpeakerSpotlightImageEditRequest(image, "Landscape spotlight", "1536x1024").size).toBe("1536x1024");
    expect(buildSpeakerSpotlightImageEditRequest(image, "Square spotlight", "1024x1024").size).toBe("1024x1024");
  });

  it("builds a high-quality agenda edit with the reference and all supplied portraits", () => {
    const image = [{} as never, {} as never, {} as never, {} as never, {} as never, {} as never];
    const request = buildSummitAgendaImageEditRequest(image, "Create the exact live session card");
    expect(request).toMatchObject({
      model: "gpt-image-2",
      image,
      prompt: "Create the exact live session card",
      size: "1024x1536",
      quality: "high",
      output_format: "png"
    });
    expect(request.image).toHaveLength(6);
  });

  it("preserves safe invalid-request diagnostics without exposing the provider message", () => {
    const error = Object.assign(new Error("400 rejected secret sk-example-do-not-expose"), {
      status: 400,
      code: "invalid_value",
      type: "invalid_request_error",
      param: "input_fidelity",
      requestID: "req_test_invalid_request"
    });

    const failure = classifyProviderError(error);

    expect(failure.code).toBe("invalid_request");
    expect(failure.details).toMatchObject({
      status: 400,
      providerCode: "invalid_value",
      providerType: "invalid_request_error",
      param: "input_fidelity",
      requestId: "req_test_invalid_request",
      retryable: false
    });
    expect(failure.message).toContain("parameter input_fidelity");
    expect(failure.message).toContain("req_test_invalid_request");
    expect(failure.message).not.toContain("sk-example-do-not-expose");
  });

  it("marks server failures as retryable and retains the request id", () => {
    const error = Object.assign(new Error("Internal server error"), {
      status: 503,
      code: "server_error",
      type: "server_error",
      requestID: "req_test_server_error"
    });

    const failure = classifyProviderError(error);

    expect(failure.code).toBe("server_error");
    expect(failure.details).toMatchObject({ status: 503, requestId: "req_test_server_error", retryable: true });
  });

  it("recognizes the SDK's timed-out wording and allows long-running provider operations", () => {
    const error = Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" });

    const failure = classifyProviderError(error);

    expect(failure.code).toBe("timeout");
    expect(failure.details.retryable).toBe(true);
    expect(OPENAI_RESEARCH_TIMEOUT_MS).toBeGreaterThan(180_000);
    expect(OPENAI_TEXT_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000);
  });

  it("enforces an end-to-end deadline even when the underlying request never settles", async () => {
    const pending = withOpenAIRequestDeadline(undefined, 20, async () => new Promise<never>(() => undefined));

    await expect(pending).rejects.toMatchObject({ code: "timeout", details: { retryable: true } });
  });

  it("records directly opened web-search pages as provider-observed evidence", () => {
    const metadata = collectSourceMetadata([{
      type: "web_search_call",
      action: { type: "open_page", url: "https://example.com/contact" }
    }]);

    expect(metadata.get("https://example.com/contact")?.webSearchAction).toMatchObject({ type: "open_page" });
  });

  it("normalizes harmless tracking and trailing-slash variants in provider evidence URLs", () => {
    const metadata = collectSourceMetadata([{
      type: "web_search_call",
      action: { type: "open_page", url: "https://example.com/contact/?utm_source=search&b=2&a=1#team" }
    }]);

    expect(metadata.get("https://example.com/contact?a=1&b=2")?.webSearchAction).toBeTruthy();
    expect(metadata.size).toBe(1);
  });

  it("uses current required-search controls and bounded enrichment batches for summit research", () => {
    expect(researchWebSearchTool("San Francisco Bay Area")).toMatchObject({
      type: "web_search", search_context_size: "medium",
      user_location: { type: "approximate", country: "US", city: "San Francisco", region: "California", timezone: "America/Los_Angeles" }
    });
    expect(researchWebSearchTool("New York City")).not.toHaveProperty("user_location");

    const candidate = (index: number): DiscoveryBundle["candidates"][number] => ({
      organizationName: `Organization ${index}`, organizationWebsite: `https://organization-${index}.example`, opportunityClass: "organization", eventName: null,
      city: "Oakland", region: "California", targetSegment: "ai_professionals", salesMotion: "partner_distribution",
      audienceFit: index % 2 ? "exact" : "strong", distributionPotential: "high", discoveryReason: "Relevant audience", discoverySourceUrl: `https://organization-${index}.example`
    });
    const discovery: DiscoveryBundle = { candidates: Array.from({ length: 50 }, (_, index) => candidate(index)), searchedSegments: ["ai_professionals"], warnings: [] };
    const batches = planResearchCandidateBatches(discovery, 18);
    expect(batches.flat()).toHaveLength(36);
    expect(batches.every((batch) => batch.length <= 10)).toBe(true);
  });

  it("reports the exact structured-output stage without exposing returned values", () => {
    expect(() => parseStructuredResponse(DiscoveryBundleSchema, { status: "completed", output_text: JSON.stringify({ private: "do not echo" }) }, "Discovery"))
      .toThrow(/Discovery did not match.*candidates:invalid_type/);
    expect(() => parseStructuredResponse(DiscoveryBundleSchema, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "" }, "Enrichment batch 2"))
      .toThrow(/Enrichment batch 2 returned an incomplete structured response.*max_output_tokens/);
  });

  it("preserves segment and sales-motion diversity before filling the enrichment pool", () => {
    const dominant = Array.from({ length: 70 }, (_, index): DiscoveryBundle["candidates"][number] => ({
      organizationName: `AI Community ${index}`, organizationWebsite: `https://community-${index}.example`, opportunityClass: "organization", eventName: null,
      city: "San Francisco", region: "California", targetSegment: "ai_professionals", salesMotion: "partner_distribution",
      audienceFit: "exact", distributionPotential: "high", discoveryReason: "Large relevant community", discoverySourceUrl: `https://community-${index}.example`
    }));
    const discovery: DiscoveryBundle = {
      candidates: [...dominant, {
        organizationName: "College Prep Network", organizationWebsite: "https://prep.example", opportunityClass: "organization", eventName: null,
        city: "Oakland", region: "California", targetSegment: "college_prep_education", salesMotion: "education_distribution",
        audienceFit: "moderate", distributionPotential: "limited", discoveryReason: "Can reach advanced students", discoverySourceUrl: "https://prep.example"
      }],
      searchedSegments: ["ai_professionals", "college_prep_education"], warnings: []
    };

    const selected = planResearchCandidateBatches(discovery, 25).flat();

    expect(selected).toHaveLength(50);
    expect(selected.some((candidate) => candidate.targetSegment === "college_prep_education")).toBe(true);
    expect(selected.some((candidate) => candidate.salesMotion === "education_distribution")).toBe(true);
  });
});
