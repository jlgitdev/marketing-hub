import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_CONTEXT } from "@/server/ai/demo-provider";
import { closeAllDatabases } from "@/server/db/database";
import {
  brandAssetStoragePath,
  createContextDocument,
  listBrandAssets,
  listContentCampaigns,
  listContextDocuments,
  resetAllData
} from "@/server/db/repository";
import {
  AssistantInputSchema,
  runAssistantRequest,
  type AssistantInput,
  type AssistantStreamEvent
} from "@/server/services/assistant-service";
import { storeBrandAsset } from "@/server/storage/assets";

const providerMocks = vi.hoisted(() => ({
  creative: vi.fn(),
  assistantImage: vi.fn(),
  imageWithReferences: vi.fn(),
  context: vi.fn()
}));

vi.mock("@/server/ai/openai-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/ai/openai-provider")>()),
  assistantCreativeWithOpenAI: providerMocks.creative,
  assistantImageWithOpenAI: providerMocks.assistantImage,
  imageWithReferencesOpenAI: providerMocks.imageWithReferences,
  assistantContextWithOpenAI: providerMocks.context
}));

const originalDataDirectory = process.env.MARKETING_HUB_DATA_DIR;
const originalDemoMode = process.env.MARKETING_HUB_DEMO_MODE;
const originalContextDirectory = process.env.MARKETING_HUB_CONTEXT_DIR;
const testDataDirectory = path.join(os.tmpdir(), `marketing-hub-assistant-live-vitest-${process.pid}`);
const projectContextDirectory = path.join(process.cwd(), "assets for context");
let generatedImageBytes: Buffer;
let uploadedImageBytes: Buffer;

beforeAll(async () => {
  process.env.MARKETING_HUB_DATA_DIR = testDataDirectory;
  process.env.MARKETING_HUB_DEMO_MODE = "false";
  process.env.MARKETING_HUB_CONTEXT_DIR = projectContextDirectory;
  generatedImageBytes = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#173c5b" } }).png().toBuffer();
  uploadedImageBytes = await sharp({ create: { width: 640, height: 480, channels: 4, background: "#d4b56f" } }).png().toBuffer();
});

beforeEach(() => {
  closeAllDatabases();
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
  resetAllData();
  providerMocks.creative.mockReset();
  providerMocks.assistantImage.mockReset();
  providerMocks.imageWithReferences.mockReset().mockResolvedValue(generatedImageBytes);
  providerMocks.context.mockReset();
});

afterAll(() => {
  closeAllDatabases();
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
  restoreEnvironment("MARKETING_HUB_DATA_DIR", originalDataDirectory);
  restoreEnvironment("MARKETING_HUB_DEMO_MODE", originalDemoMode);
  restoreEnvironment("MARKETING_HUB_CONTEXT_DIR", originalContextDirectory);
});

describe("Summit Assistant live provider paths", () => {
  it("accepts the first social draft and first image while applying canonical logo and style assets", async () => {
    DEMO_CONTEXT.forEach((document) => createContextDocument(document));
    providerMocks.creative.mockResolvedValue({
      bundle: {
        post: {
          text: "Builders and researchers are meeting in San Francisco to turn ambitious AI ideas into practical systems.",
          hook: "Turn ambitious AI ideas into practical systems.",
          callToAction: "See the AGI Summit program",
          hashtags: "#AGISummit #AppliedAI"
        },
        graphic: {
          prompt: "Create one complete cobalt editorial conference graphic with a warm central gathering point. Render the exact words \"AGI Summit\" and reproduce the supplied official logo faithfully. Include no extra words.",
          headline: "AGI Summit",
          subheadline: "Builders · Researchers · San Francisco",
          footer: "See the program",
          altText: "A precise cobalt conference composition with a warm central gathering point.",
          aspectRatio: "16:9",
          textPlacement: "left",
          overlayText: true,
          logoPlacement: "top_right"
        },
        notes: []
      },
      usage: { input_tokens: 120, output_tokens: 80 }
    });

    const events: AssistantStreamEvent[] = [];
    const message = await runAssistantRequest(input({
      mode: "create",
      platform: "x",
      prompt: "Create one credible registration post and a matching AGI Summit graphic."
    }), "sk-live-test", (event) => events.push(event));

    expect(providerMocks.creative).toHaveBeenCalledTimes(1);
    expect(providerMocks.imageWithReferences).toHaveBeenCalledTimes(1);
    expect(providerMocks.assistantImage).not.toHaveBeenCalled();
    expect(providerMocks.context).not.toHaveBeenCalled();
    expect(providerMocks.creative.mock.calls[0][0]).toBe("sk-live-test");
    expect(providerMocks.creative.mock.calls[0][1]).toMatchObject({
      instructions: expect.stringMatching(/current user request.*primary creative brief/is),
      brief: expect.stringMatching(/MEDIA TARGET[\s\S]*X\./),
      images: [expect.objectContaining({ role: "style_reference" }), expect.objectContaining({ role: "logo_reference" })]
    });

    const assets = listBrandAssets();
    const logo = assets.find((asset) => asset.title === "AGI Summit logo");
    const style = assets.find((asset) => asset.title === "AGI Summit social style reference");
    expect(logo).toMatchObject({ type: "logo", active: true });
    expect(style).toMatchObject({ type: "visual_reference", active: true });

    const referenceRequest = providerMocks.imageWithReferences.mock.calls[0][1] as {
      references: Array<{ filePath: string; mimeType: string }>;
      prompt: string;
      size: string;
      quality: string;
    };
    expect(referenceRequest).toMatchObject({
      references: [
        { filePath: brandAssetStoragePath(style!.id), mimeType: style!.mimeType },
        { filePath: brandAssetStoragePath(logo!.id), mimeType: logo!.mimeType }
      ],
      size: "1536x864",
      quality: "high"
    });
    expect(referenceRequest.prompt).toContain("Image 1 is the AGI Summit style reference");
    expect(referenceRequest.prompt).toContain("Image 2 is the official logo");
    expect(referenceRequest.prompt).toContain("complete, finished campaign graphic");

    const campaign = listContentCampaigns().find((item) => item.id === message.contentCampaignId);
    const emittedAsset = events.find((event): event is Extract<AssistantStreamEvent, { type: "asset" }> => event.type === "asset");
    const composite = campaign?.assets.find((asset) => asset.id === emittedAsset?.assetId);
    expect(message).toMatchObject({ status: "completed", contentCampaignId: campaign?.id, generatedAssetId: emittedAsset?.assetId });
    expect(campaign).toMatchObject({ provider: "openai", selectedBrandAssetId: logo!.id });
    expect(campaign?.posts).toHaveLength(1);
    expect(campaign?.posts[0].text).toContain("Builders and researchers");
    expect(composite).toMatchObject({
      id: message.generatedAssetId,
      kind: "composite",
      mimeType: "image/png",
      overlay: {
        logoAssetId: logo!.id,
        referenceAssetId: style!.id,
        referenceMode: "style",
        platform: "x"
      }
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "stage",
      id: "image",
      state: "completed",
      detail: expect.stringMatching(/first decodable GPT Image 2 result.*no visual QA, retry, or replacement/i)
    }));
  });

  it("reads one uploaded image in one structured call and durably saves reusable Markdown", async () => {
    const upload = await storeBrandAsset({
      title: "Speaker publishing checklist screenshot",
      type: "assistant_attachment",
      fileName: "speaker-publishing-checklist.png",
      mimeType: "image/png",
      bytes: uploadedImageBytes
    });
    const uploadedPath = brandAssetStoragePath(upload.id)!;
    expect(fs.existsSync(uploadedPath)).toBe(true);
    providerMocks.context.mockResolvedValue({
      bundle: {
        title: "Speaker Spotlight Publishing Workflow",
        type: "workflow_guide",
        body: "# Speaker Spotlight Publishing Workflow\n\n## Required checks\n\n1. Verify the speaker name, role, and organization.\n2. Use the approved portrait and AGI Summit visual system.\n3. Confirm the caption and destination link before publishing.\n\n## Reuse\n\nApply this checklist to future speaker spotlight content.",
        summary: "A reusable pre-publication checklist for AGI Summit speaker spotlight content.",
        tags: ["speaker spotlight", "publishing", "quality checks"],
        platforms: ["x", "linkedin", "instagram"],
        purposes: ["content", "speaker_spotlight"]
      },
      usage: { input_tokens: 240, output_tokens: 160 }
    });

    const events: AssistantStreamEvent[] = [];
    const message = await runAssistantRequest(input({
      mode: "context",
      prompt: "Save the visible speaker publishing checklist for reuse.",
      attachmentIds: [upload.id]
    }), "sk-live-test", (event) => events.push(event));

    expect(providerMocks.context).toHaveBeenCalledTimes(1);
    expect(providerMocks.creative).not.toHaveBeenCalled();
    expect(providerMocks.assistantImage).not.toHaveBeenCalled();
    expect(providerMocks.imageWithReferences).not.toHaveBeenCalled();
    expect(providerMocks.context.mock.calls[0][0]).toBe("sk-live-test");
    const contextRequest = providerMocks.context.mock.calls[0][1] as {
      instructions: string;
      sourceText: string;
      images: Array<{ filePath: string; mimeType: string }>;
    };
    expect(contextRequest.sourceText).toContain("Speaker publishing checklist screenshot (image/png)");
    expect(contextRequest.sourceText).toContain("Save the visible speaker publishing checklist for reuse.");
    expect(contextRequest.images).toEqual([{ filePath: uploadedPath, mimeType: "image/png" }]);
    expect(brandAssetStoragePath(upload.id)).toBeNull();
    expect(fs.existsSync(uploadedPath)).toBe(false);

    const saved = listContextDocuments().find((document) => document.id === message.savedContextDocumentId);
    expect(message).toMatchObject({ mode: "context", status: "completed", savedContextDocumentId: saved?.id });
    expect(saved).toMatchObject({
      title: "Speaker Spotlight Publishing Workflow",
      type: "workflow_guide",
      active: true,
      sourceOfTruth: false,
      origin: "user",
      summary: "A reusable pre-publication checklist for AGI Summit speaker spotlight content.",
      platforms: ["x", "linkedin", "instagram"],
      purposes: expect.arrayContaining(["content", "speaker_spotlight"])
    });
    expect(saved?.body).toMatch(/^# Speaker Spotlight Publishing Workflow/);
    expect(saved?.body).toContain("## Required checks");
    expect(saved?.body).toContain("Apply this checklist to future speaker spotlight content.");
    expect(saved?.notes).toMatch(/Summit Assistant.*1 uploaded image/);
    expect(events).toContainEqual({
      type: "context_saved",
      document: expect.objectContaining({ id: saved?.id, title: saved?.title, type: "workflow_guide" })
    });

    closeAllDatabases();
    expect(listContextDocuments()).toContainEqual(expect.objectContaining({
      id: saved?.id,
      body: saved?.body,
      active: true
    }));
  });
});

function input(value: Partial<AssistantInput> & Pick<AssistantInput, "mode">) {
  return AssistantInputSchema.parse(value);
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
