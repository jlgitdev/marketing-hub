import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_CONTEXT } from "@/server/ai/demo-provider";
import { closeDatabase, getDatabase } from "@/server/db/database";
import { createContextDocument, createSpeakerSpotlightBatch, listResearchRuns, listSpeakerSpotlightBatches, resetAllData } from "@/server/db/repository";
import { cancelAiOperation, dismissAiOperation, listPublicOperations, retryAiOperation, sanitizeOperationInput, startAiOperation } from "@/server/operations/manager";
import { createAiOperation, getAiOperation, publicOperation, updateAiOperation } from "@/server/operations/repository";
import { pendingSteps } from "@/server/operations/types";
import { generateContentCampaign } from "@/server/services/content-service";
import { hasExternalSpeakerSite } from "./external-speaker-site";

beforeEach(() => resetAllData());
afterEach(() => vi.unstubAllEnvs());
afterAll(() => closeDatabase());

function researchInput(name: string) {
  const context = DEMO_CONTEXT.map((document) => createContextDocument(document));
  return {
    name,
    objective: "Find fictional, source-backed AI event opportunities",
    region: "San Francisco Bay Area",
    count: 4,
    contextDocumentIds: context.map((document) => document.id),
    opportunityTypes: ["organization", "event"] as Array<"organization" | "event">,
    organizationCategories: ["AI community"], eventCategories: ["AI events"],
    targetRoles: ["partnerships"], audienceRoles: ["builders"],
    positiveKeywords: "AI", exclusionKeywords: "", dateRange: "", notes: ""
  };
}

async function waitForStatus(id: string, statuses: string[], timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const operation = getAiOperation(id);
    if (operation && statuses.includes(operation.status)) return operation;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Operation ${id} did not reach ${statuses.join(" or ")}.`);
}

describe("persistent AI operations", () => {
  it("acknowledges immediately, redacts persisted input, and exposes no retry payload publicly", async () => {
    vi.stubEnv("MARKETING_HUB_DEMO_DELAY_MS", "40");
    const secret = "sk-test-operation-secret-123456";
    const operation = startAiOperation({
      kind: "research", label: "Privacy scan",
      operationInput: { ...researchInput("Privacy scan"), apiKey: secret, documentBody: "private selected context body", notes: `accidental ${secret}` },
      originPath: "/leads", targetKey: "research:privacy", sessionId: "opaque-session"
    });

    expect(operation.status).toBe("queued");
    expect(operation).not.toHaveProperty("input");
    const stored = String((getDatabase().prepare("SELECT input_json FROM ai_operations WHERE id=?").get(operation.id) as { input_json: string }).input_json);
    expect(stored).not.toContain(secret);
    expect(stored).not.toContain("private selected context body");
    expect(stored).toContain("REDACTED");

    const completed = await waitForStatus(operation.id, ["completed"]);
    expect(completed.resultHref).toMatch(/^\/leads\?run=/);
    expect(JSON.stringify(listPublicOperations())).not.toContain("input_json");
    expect(JSON.stringify(listPublicOperations())).not.toContain(secret);
  });

  it("serializes jobs, prevents duplicate targets, and cancels queued work before provider execution", async () => {
    vi.stubEnv("MARKETING_HUB_DEMO_DELAY_MS", "120");
    const first = startAiOperation({ kind: "research", label: "First queued scan", operationInput: researchInput("First queued scan"), originPath: "/leads", targetKey: "research:first", sessionId: null });
    expect(() => startAiOperation({ kind: "research", label: "Duplicate", operationInput: researchInput("Duplicate"), originPath: "/leads", targetKey: "research:first", sessionId: null })).toThrow(/already/);
    const second = startAiOperation({ kind: "research", label: "Canceled queued scan", operationInput: researchInput("Canceled queued scan"), originPath: "/leads", targetKey: "research:second", sessionId: null });

    expect(getAiOperation(second.id)?.status).toBe("queued");
    expect(cancelAiOperation(second.id).status).toBe("canceled");
    await waitForStatus(first.id, ["completed"]);
    expect(listResearchRuns().some((run) => run.name === "Canceled queued scan")).toBe(false);
  });

  it("turns active cancellation into a terminal retryable record without starting the workflow", async () => {
    vi.stubEnv("MARKETING_HUB_DEMO_DELAY_MS", "500");
    const operation = startAiOperation({ kind: "research", label: "Cancelable scan", operationInput: researchInput("Cancelable scan"), originPath: "/leads", targetKey: "research:cancelable", sessionId: null });
    await waitForStatus(operation.id, ["running"]);
    expect(cancelAiOperation(operation.id).status).toBe("cancel_requested");
    const canceled = await waitForStatus(operation.id, ["canceled"]);
    expect(canceled.retryable).toBe(true);
    expect(listResearchRuns().some((run) => run.name === "Cancelable scan")).toBe(false);
  });

  it("continues countable platform regeneration after an individual failure and reports the exact partial result", async () => {
    const contextIds = researchInput("Context seed").contextDocumentIds;
    const campaign = await generateContentCampaign({ name: "Partial platform campaign", brief: "Create one complete LinkedIn draft for a partial regeneration test", objective: "Awareness", audience: "AI builders", callToAction: "Learn more", contextDocumentIds: contextIds, platforms: ["linkedin"] }, null);
    const operation = startAiOperation({ kind: "content_regenerate", label: "Regenerate requested platforms", operationInput: { campaignId: campaign.id, platforms: ["x", "linkedin"] }, originPath: "/content", targetKey: `content:regenerate:${campaign.id}:linkedin,x`, sessionId: null, totalUnits: 2, unitLabel: "platforms" });
    const partial = await waitForStatus(operation.id, ["partially_completed"]);
    expect(partial).toMatchObject({ completedUnits: 1, totalUnits: 2, retryable: true });
    expect(partial.error).toMatch(/1 of 2 platforms updated/);
    expect(partial.error).toMatch(/x:/);
  });

  it.skipIf(!hasExternalSpeakerSite)("reports a Spotlight batch with no completed package as failed instead of still in progress", async () => {
    const operation = startAiOperation({
      kind: "spotlight_batch",
      label: "Speaker Spotlight · Missing Speaker",
      operationInput: { speakerNames: ["Definitely Missing Speaker"], config: {} },
      originPath: "/speaker-spotlight",
      targetKey: "spotlight:missing-speaker",
      sessionId: null,
      totalUnits: 1,
      unitLabel: "speakers"
    });

    const failed = await waitForStatus(operation.id, ["failed"]);
    expect(failed).toMatchObject({ completedUnits: 0, totalUnits: 1, retryable: true });
    expect(failed.resultHref).toMatch(/^\/speaker-spotlight\?batch=/);
    expect(failed.steps.at(-1)?.state).toBe("failed");
  });

  it("marks unfinished database records interrupted after a process restart and can retry partial work", () => {
    const stored = createAiOperation({
      kind: "research", label: "Interrupted scan", steps: pendingSteps([["preparing", "Prepare request"]]),
      originPath: "/leads", targetKey: "research:interrupted", operationInput: researchInput("Interrupted scan")
    });
    closeDatabase();
    getDatabase();
    const interrupted = getAiOperation(stored.id)!;
    expect(interrupted).toMatchObject({ status: "interrupted", retryable: true });

    updateAiOperation(stored.id, { status: "partially_completed", retryable: true });
    const retried = retryAiOperation(stored.id, null);
    expect(retried).toMatchObject({ status: "queued", kind: "research" });
    expect(retried.id).not.toBe(stored.id);
    cancelAiOperation(retried.id);
  });

  it("turns an unfinished Spotlight batch into a retryable preserved package after restart", () => {
    const now = new Date().toISOString();
    const batchId = "00000000-0000-4000-8000-000000000020";
    createSpeakerSpotlightBatch({
      id: batchId,
      speakerNames: ["Restarted Speaker"],
      status: "running",
      config: { eventName: "AGI Summit", eventDates: "July 18–19", eventVenue: "San Francisco", eventWebsite: "agisummit.ai", ticketUrl: "https://example.com", discountCopy: "Test discount", siteDirectory: "/tmp" },
      model: "gpt-image-2",
      promptVersion: "test",
      provider: "openai",
      warnings: [],
      error: null,
      createdAt: now,
      completedAt: null,
      results: [{
        id: "00000000-0000-4000-8000-000000000021",
        batchId,
        inputName: "Restarted Speaker",
        profileKey: "restartedspeaker",
        slug: "restarted-speaker",
        status: "generating_image",
        profile: { inputName: "Restarted Speaker", displayName: "Restarted Speaker", profileKey: "restartedspeaker", subtitle: null, roleLine: "AI researcher", bio: null, highlights: [], industries: [], stats: [], tags: [], badge: null, linkedinUrl: null, xUrl: null, xHandle: null, source: { bundlePath: "/tmp/index.js", verified: true } },
        post: "Preserved caption",
        headshotFileName: "headshot.png",
        imageFileName: null,
        headshotAssetId: "headshot-asset",
        imageAssetId: null,
        imagePrompt: "Preserved prompt",
        qa: null,
        requestIds: [],
        retryCount: 0,
        providerError: null,
        error: null,
        createdAt: now,
        updatedAt: now
      }]
    });

    closeDatabase();
    getDatabase();
    const recovered = listSpeakerSpotlightBatches().find((batch) => batch.id === batchId)!;
    expect(recovered).toMatchObject({ status: "partially_completed", completedAt: expect.any(String) });
    expect(recovered.results[0]).toMatchObject({ status: "failed", post: "Preserved caption", imagePrompt: "Preserved prompt" });
    expect(recovered.results[0].error).toMatch(/preserved and can be retried/i);
  });

  it("dismisses terminal activity without deleting its saved operation record", () => {
    const stored = createAiOperation({ kind: "research", label: "Finished history", steps: pendingSteps([["preparing", "Prepare request"]]), originPath: "/leads", targetKey: "research:dismiss", operationInput: researchInput("Finished history") });
    updateAiOperation(stored.id, { status: "failed", retryable: true, completedAt: new Date().toISOString() });
    dismissAiOperation(stored.id);
    expect(listPublicOperations().some((item) => item.id === stored.id)).toBe(false);
    expect(getAiOperation(stored.id)).toMatchObject({ id: stored.id, status: "failed" });
  });

  it("supports explicit state transitions while public serialization always omits the validated retry input", () => {
    const stored = createAiOperation({ kind: "content_regenerate", label: "Regenerate LinkedIn", steps: pendingSteps([["loading", "Load"], ["saving", "Save"]]), originPath: "/content", targetKey: "content:test", operationInput: { campaignId: "00000000-0000-4000-8000-000000000001", platforms: ["linkedin"] }, totalUnits: 1, unitLabel: "platforms" });
    updateAiOperation(stored.id, { status: "running", steps: [{ ...stored.steps[0], state: "active" }, stored.steps[1]] });
    const completed = updateAiOperation(stored.id, { status: "completed", completedUnits: 1, completedAt: new Date().toISOString() });
    expect(completed.status).toBe("completed");
    expect(publicOperation(completed)).not.toHaveProperty("input");
    expect(sanitizeOperationInput({ authorization: "Bearer secret", body: "selected document", control: "keep" })).toEqual({ control: "keep" });
  });
});
