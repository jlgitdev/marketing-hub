import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_CONTEXT } from "@/server/ai/demo-provider";
import { closeAllDatabases } from "@/server/db/database";
import {
  clearAssistantMessages,
  createAssistantMessage,
  createBrandAsset,
  createContextDocument,
  deleteContentCampaign,
  deleteContextDocument,
  listAssistantMessages,
  listBrandAssets,
  listContentCampaigns,
  listContextDocuments,
  resetAllData
} from "@/server/db/repository";
import {
  AssistantInputSchema,
  assistantTextChunks,
  inferPlatformFromPrompt,
  runAssistantRequest,
  type AssistantInput,
  type AssistantStreamEvent
} from "@/server/services/assistant-service";
import { createWorkspaceRecord, runInWorkspace } from "@/server/workspaces/registry";
import { dataDirectory } from "@/server/config";
import { hasActiveAssistantJobs, registerAssistantJob } from "@/server/services/assistant-runtime";
import { deleteWorkspace } from "@/server/workspaces/service";

const originalDataDirectory = process.env.MARKETING_HUB_DATA_DIR;
const originalDemoMode = process.env.MARKETING_HUB_DEMO_MODE;
const testDataDirectory = path.join(os.tmpdir(), `marketing-hub-assistant-vitest-${process.pid}`);

beforeAll(() => {
  process.env.MARKETING_HUB_DATA_DIR = testDataDirectory;
  process.env.MARKETING_HUB_DEMO_MODE = "true";
});

beforeEach(() => {
  closeAllDatabases();
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
  resetAllData();
});

afterAll(() => {
  closeAllDatabases();
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
  if (originalDataDirectory === undefined) delete process.env.MARKETING_HUB_DATA_DIR;
  else process.env.MARKETING_HUB_DATA_DIR = originalDataDirectory;
  if (originalDemoMode === undefined) delete process.env.MARKETING_HUB_DEMO_MODE;
  else process.env.MARKETING_HUB_DEMO_MODE = originalDemoMode;
});

function input(value: Partial<AssistantInput> & Pick<AssistantInput, "mode">) {
  return AssistantInputSchema.parse(value);
}

function seedDemoContext() {
  return DEMO_CONTEXT.map((document) => createContextDocument(document));
}

async function run(value: AssistantInput) {
  const events: AssistantStreamEvent[] = [];
  const message = await runAssistantRequest(value, null, (event) => events.push(event));
  return { message, events };
}

function savedMessage(content: string, mode: AssistantInput["mode"] = "ask") {
  return createAssistantMessage({
    role: "assistant",
    mode,
    content,
    status: "completed",
    attachmentIds: [],
    contextDocumentIds: [],
    generatedAssetId: null,
    contentCampaignId: null,
    savedContextDocumentId: null,
    warnings: []
  });
}

describe("Summit Assistant input contract", () => {
  it("strictly validates modes, platforms, and attachment boundaries", () => {
    expect(AssistantInputSchema.safeParse({ mode: "other", prompt: "Question" }).success).toBe(false);
    expect(AssistantInputSchema.safeParse({ mode: "ask", prompt: "When is it?", platform: "x" }).success).toBe(false);
    expect(AssistantInputSchema.safeParse({ mode: "ask", prompt: "When is it?", attachmentIds: ["00000000-0000-4000-8000-000000000001"] }).success).toBe(false);
    expect(AssistantInputSchema.safeParse({ mode: "create", prompt: "Write a launch post" }).success).toBe(true);
    expect(AssistantInputSchema.safeParse({ mode: "create", prompt: "Write a launch post", platform: "tiktok" }).success).toBe(false);
    expect(AssistantInputSchema.safeParse({ mode: "create", prompt: "Write a launch post", platform: "x", attachmentIds: [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002"
    ] }).success).toBe(false);
    expect(AssistantInputSchema.safeParse({ mode: "context", prompt: "Save this", unexpected: true }).success).toBe(false);
    expect(AssistantInputSchema.safeParse({ mode: "context", prompt: "x".repeat(40_001) }).success).toBe(true);
    expect(AssistantInputSchema.safeParse({ mode: "context", prompt: "x".repeat(120_001) }).success).toBe(false);
    expect(AssistantInputSchema.safeParse({ mode: "context", attachmentIds: [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000004",
      "00000000-0000-4000-8000-000000000005"
    ] }).success).toBe(false);
  });

  it("infers one explicit platform from the single create prompt and stays unrestricted when several are named", () => {
    expect(inferPlatformFromPrompt("Write a concise post on X")).toBe("x");
    expect(inferPlatformFromPrompt("Create a LinkedIn announcement")).toBe("linkedin");
    expect(inferPlatformFromPrompt("Make X, LinkedIn, and Instagram posts")).toBe("general");
  });

  it("reconstructs streamed text exactly from deterministic chunks", () => {
    const source = "First line with  two spaces.\n\nSecond line — with emoji 🚀 and a-final-token.";
    const chunks = assistantTextChunks(source, 17);

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.join("")).toBe(source);
    expect(chunks.every((chunk) => chunk.length > 0)).toBe(true);
  });
});

describe("Summit Assistant deterministic workflows", () => {
  it("grounds demo Ask in saved context and persists the exact source IDs", async () => {
    const source = createContextDocument(DEMO_CONTEXT[0]);
    const { message, events } = await run(input({ mode: "ask", prompt: "When and where is the forum?" }));
    const streamed = events.filter((event): event is Extract<AssistantStreamEvent, { type: "delta" }> => event.type === "delta").map((event) => event.delta).join("");

    expect(message).toMatchObject({ role: "assistant", mode: "ask", status: "completed", contextDocumentIds: [source.id] });
    expect(message.content).toContain("October 14, 2026");
    expect(message.content).toContain("Pier 27, San Francisco");
    expect(streamed).toBe(message.content);
    expect(listAssistantMessages()).toEqual([expect.objectContaining({ id: message.id, contextDocumentIds: [source.id] })]);
  });

  it("answers from workspace facts and the local agenda when no Context document exists", async () => {
    const { message } = await run(input({ mode: "ask", prompt: "Where is the summit and what is on the agenda?" }));

    expect(message.contextDocumentIds).toEqual([]);
    expect(message.content).toContain("Location: San Francisco");
    expect(message.content).toContain("local agenda");
    expect(message.content).not.toMatch(/couldn.t find active summit context/i);
  });

  it("creates one platform post and exposes the first saved composite graphic", async () => {
    seedDemoContext();
    const { message, events } = await run(input({
      mode: "create",
      platform: "instagram",
      prompt: "Create a practical registration post and matching summit graphic."
    }));
    const campaign = listContentCampaigns().find((item) => item.id === message.contentCampaignId);

    expect(message).toMatchObject({ mode: "create", status: "completed", generatedAssetId: expect.any(String), generatedAssetWidth: 1232, generatedAssetHeight: 1536, contentCampaignId: expect.any(String) });
    expect(campaign?.posts).toHaveLength(1);
    expect(campaign?.posts[0].platform).toBe("instagram");
    expect(campaign?.assets.filter((asset) => asset.kind === "composite")).toEqual([
      expect.objectContaining({ id: message.generatedAssetId, mimeType: "image/png", width: 1232, height: 1536 })
    ]);
    const composite = campaign?.assets.find((asset) => asset.id === message.generatedAssetId);
    const logo = listBrandAssets().find((asset) => asset.title === "AGI Summit logo");
    const style = listBrandAssets().find((asset) => asset.title === "AGI Summit social style reference");
    expect(composite?.overlay).toMatchObject({ logoAssetId: logo?.id, referenceAssetId: style?.id, referenceMode: "style" });
    expect(events.filter((event) => event.type === "asset")).toEqual([{ type: "asset", assetId: message.generatedAssetId, width: 1232, height: 1536 }]);
    expect(listAssistantMessages()).toEqual([expect.objectContaining({ id: message.id, generatedAssetWidth: 1232, generatedAssetHeight: 1536 })]);
  });

  it("defaults Create content to an unrestricted media target", async () => {
    seedDemoContext();
    const { message } = await run(input({ mode: "create", prompt: "Create a polished summit announcement and graphic." }));
    const campaign = listContentCampaigns().find((item) => item.id === message.contentCampaignId);

    expect(campaign?.platforms).toEqual(["general"]);
    expect(campaign?.posts[0].platform).toBe("general");
    expect(campaign?.assets.find((asset) => asset.id === message.generatedAssetId)).toMatchObject({ width: 1024, height: 1024 });
  });

  it("honors requested image dimensions in one pass and records non-blocking normalization notes", async () => {
    seedDemoContext();
    const { message } = await run(input({ mode: "create", prompt: "Make a vertical summit graphic at 1080x1920 px with a concise announcement." }));
    const campaign = listContentCampaigns().find((item) => item.id === message.contentCampaignId);
    const graphic = campaign?.assets.find((asset) => asset.id === message.generatedAssetId);

    expect(graphic).toMatchObject({ width: 1088, height: 1920 });
    expect(message.warnings.join(" ")).toMatch(/requested 1080 × 1920px.*used 1088 × 1920px.*without retrying/i);
  });

  it("keeps the full Create brief while fitting long prompts into the image-direction contract", async () => {
    seedDemoContext();
    const prompt = `Create a registration post with a bold but credible graphic. ${"detail ".repeat(150)}`;
    const { message } = await run(input({ mode: "create", platform: "x", prompt }));

    expect(prompt.length).toBeGreaterThan(1_000);
    expect(message).toMatchObject({ status: "completed", generatedAssetId: expect.any(String) });
  });

  it("preserves generated text as a partial result when the selected image cannot be read", async () => {
    seedDemoContext();
    const missingPath = path.join(dataDirectory(), "uploads", "missing-reference.png");
    const brokenReference = createBrandAsset({
      title: "Missing visual reference",
      type: "visual_reference",
      fileName: "missing-reference.png",
      storagePath: missingPath,
      mimeType: "image/png",
      width: 512,
      height: 512,
      sizeBytes: 128,
      active: true
    });
    const { message, events } = await run(input({
      mode: "create",
      platform: "x",
      prompt: "Create one concise registration post and graphic.",
      attachmentIds: [brokenReference.id]
    }));
    const campaign = listContentCampaigns().find((item) => item.id === message.contentCampaignId);

    expect(message).toMatchObject({ mode: "create", status: "partial", generatedAssetId: null, contentCampaignId: expect.any(String) });
    expect(message.content.trim().length).toBeGreaterThan(40);
    expect(message.warnings.join(" ")).toMatch(/Graphic not created/i);
    expect(campaign?.posts).toHaveLength(1);
    expect(campaign?.assets).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({ type: "stage", id: "image", state: "failed" }));
  });

  it("saves Add context output as active Markdown without silently making it a source of truth", async () => {
    const existingSource = createContextDocument(DEMO_CONTEXT[0]);
    const { message, events } = await run(input({
      mode: "context",
      prompt: "# Speaker spotlight workflow\n\n1. Verify the speaker profile.\n2. Use the approved portrait.\n3. Publish only after review."
    }));
    const saved = listContextDocuments().find((document) => document.id === message.savedContextDocumentId);

    expect(saved).toMatchObject({ active: true, sourceOfTruth: false });
    expect(saved?.type).toEqual(expect.any(String));
    expect(saved?.body).toMatch(/^# Speaker spotlight workflow/);
    expect(saved?.body).toContain("1. Verify the speaker profile.");
    expect(listContextDocuments().find((document) => document.id === existingSource.id)?.sourceOfTruth).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: "context_saved", document: expect.objectContaining({ id: saved?.id }) }));
  });

  it("replaces the prior primary document when Add context is explicitly marked as the source of truth", async () => {
    const existingSource = createContextDocument(DEMO_CONTEXT[0]);
    const { message } = await run(input({
      mode: "context",
      sourceOfTruth: true,
      prompt: "# Approved summit facts\n\nDate: November 8, 2026\nLocation: Fort Mason, San Francisco."
    }));
    const documents = listContextDocuments();

    expect(documents.find((document) => document.id === message.savedContextDocumentId)?.sourceOfTruth).toBe(true);
    expect(documents.find((document) => document.id === existingSource.id)?.sourceOfTruth).toBe(false);
    expect(documents.filter((document) => document.sourceOfTruth)).toHaveLength(1);

    closeAllDatabases();
    expect(listContextDocuments().filter((document) => document.sourceOfTruth)).toEqual([
      expect.objectContaining({ id: message.savedContextDocumentId })
    ]);
  });

  it("rejects invalid or unavailable attachments before creating workflow side effects", async () => {
    expect(AssistantInputSchema.safeParse({ mode: "context", attachmentIds: ["not-a-uuid"] }).success).toBe(false);
    expect(listAssistantMessages()).toEqual([]);
    expect(listContextDocuments()).toEqual([]);
    expect(listContentCampaigns()).toEqual([]);

    const unavailable = input({ mode: "context", attachmentIds: ["00000000-0000-4000-8000-000000000099"] });
    await expect(runAssistantRequest(unavailable, null, () => undefined)).rejects.toThrow(/attachments are unavailable/i);

    expect(listAssistantMessages()).toEqual([]);
    expect(listContextDocuments()).toEqual([]);
    expect(listContentCampaigns()).toEqual([]);
  });

  it("clears assistant history without deleting durable Context records", () => {
    const context = createContextDocument(DEMO_CONTEXT[0]);
    savedMessage("First answer");
    savedMessage("Saved a context note", "context");
    expect(listAssistantMessages()).toHaveLength(2);

    clearAssistantMessages();

    expect(listAssistantMessages()).toEqual([]);
    expect(listContextDocuments()).toEqual([expect.objectContaining({ id: context.id })]);
  });

  it("nulls transcript artifact links when their durable records are deleted", async () => {
    seedDemoContext();
    const created = await run(input({ mode: "create", platform: "x", prompt: "Create one concise summit post and graphic." }));
    const ingested = await run(input({ mode: "context", prompt: "# Temporary workflow\n\nA removable workflow note." }));

    deleteContentCampaign(created.message.contentCampaignId!);
    deleteContextDocument(ingested.message.savedContextDocumentId!);

    expect(listAssistantMessages().find((message) => message.id === created.message.id)).toMatchObject({ contentCampaignId: null, generatedAssetId: null });
    expect(listAssistantMessages().find((message) => message.id === ingested.message.id)).toMatchObject({ savedContextDocumentId: null });
  });

  it("redacts credential-shaped text before chat or context persistence", async () => {
    const secret = "sk-super-secret-123456789";
    const message = savedMessage(`Do not keep ${secret}`);
    expect(message.content).toContain("sk-[REDACTED]");
    expect(message.content).not.toContain(secret);

    const result = await run(input({ mode: "context", prompt: `# Internal note\n\nCredential pasted by mistake: ${secret}` }));
    const saved = listContextDocuments().find((document) => document.id === result.message.savedContextDocumentId);
    expect(saved?.body).toContain("sk-[REDACTED]");
    expect(saved?.body).not.toContain(secret);

    seedDemoContext();
    const created = await run(input({ mode: "create", platform: "x", prompt: `Create a registration post. Accidental token: ${secret}` }));
    const campaign = listContentCampaigns().find((item) => item.id === created.message.contentCampaignId);
    expect(JSON.stringify(campaign)).toContain("sk-[REDACTED]");
    expect(JSON.stringify(campaign)).not.toContain(secret);
  });

  it("removes temporary Assistant image uploads after context ingestion", async () => {
    const storagePath = path.join(dataDirectory(), "uploads", "temporary-assistant-source.png");
    const temporary = createBrandAsset({
      title: "Assistant source — temporary screenshot.png",
      type: "assistant_attachment",
      fileName: "temporary-assistant-source.png",
      storagePath,
      mimeType: "image/png",
      width: 640,
      height: 480,
      sizeBytes: 128,
      active: true
    });

    const result = await run(input({
      mode: "context",
      prompt: "Save this screenshot as a reusable publishing checklist.",
      attachmentIds: [temporary.id]
    }));

    expect(result.message).toMatchObject({ status: "completed", savedContextDocumentId: expect.any(String) });
    expect(listBrandAssets().some((asset) => asset.id === temporary.id)).toBe(false);
  });

  it("blocks workspace deletion while an Assistant job is active", () => {
    const workspace = createWorkspaceRecord({ name: "Active Assistant Workspace" });
    const controller = new AbortController();
    const unregister = registerAssistantJob(workspace.id, controller);
    expect(hasActiveAssistantJobs(workspace.id)).toBe(true);
    expect(() => deleteWorkspace(workspace.id, workspace.name)).toThrow(/active Summit Assistant response/i);
    unregister();
    expect(hasActiveAssistantJobs(workspace.id)).toBe(false);
    expect(deleteWorkspace(workspace.id, workspace.name).deleted.id).toBe(workspace.id);
  });

  it("keeps assistant history and grounding isolated across runInWorkspace scopes", async () => {
    const originalContext = createContextDocument({ ...DEMO_CONTEXT[0], title: "Original Summit", body: "# Original Summit\n\nDate: October 14, 2026 at Pier 27." });
    const originalResult = await run(input({ mode: "ask", prompt: "When is the Original Summit?" }));
    const second = createWorkspaceRecord({ name: "Robotics Leadership Forum" });

    const secondResult = await runInWorkspace(second.id, async () => {
      const secondContext = createContextDocument({ ...DEMO_CONTEXT[0], title: "Robotics Forum", body: "# Robotics Forum\n\nDate: April 12, 2027 in Oakland." });
      const result = await run(input({ mode: "ask", prompt: "When is the Robotics Forum?" }));
      expect(result.message.contextDocumentIds).toEqual([secondContext.id]);
      expect(result.message.content).toContain("April 12, 2027");
      expect(listAssistantMessages().map((message) => message.id)).toEqual([result.message.id]);
      return result;
    });

    expect(secondResult.message.id).not.toBe(originalResult.message.id);
    expect(listAssistantMessages()).toEqual([expect.objectContaining({ id: originalResult.message.id, contextDocumentIds: [originalContext.id] })]);
    expect(listAssistantMessages()[0].content).toContain("October 14, 2026");
    expect(runInWorkspace(second.id, () => listAssistantMessages())).toEqual([expect.objectContaining({ id: secondResult.message.id })]);
  });
});
