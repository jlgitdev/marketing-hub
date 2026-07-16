import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase } from "@/server/db/database";
import { resetAllData, updateSpeakerSpotlightResult } from "@/server/db/repository";
import { approveSpeakerSpotlightImage, createSpeakerSpotlights, headshotQaAllowsGeneration } from "@/server/services/speaker-spotlight-service";
import { hasExternalSpeakerSite } from "./external-speaker-site";

const providerMocks = vi.hoisted(() => ({ image: vi.fn() }));

vi.mock("@/server/ai/openai-provider", () => {
  class ProviderFailure extends Error {
    constructor(public code: string, message: string, public details = { status: null, providerCode: null, providerType: null, param: null, requestId: null, retryable: false, moderationStage: null, moderationCategories: [] as string[] }) { super(message); }
  }
  return {
    ProviderFailure,
    speakerHeadshotQaWithOpenAI: vi.fn(async () => ({
      requestId: "req_headshot_qa",
      bundle: {
        faceVisible: true,
        approved: false,
        singlePerson: true,
        usablePortrait: false,
        notLogoGraphicOrThumbnail: true,
        notVisiblyCorrupted: false,
        issues: ["Rough background-removal artifacts around the hair and shoulders."]
      }
    })),
    speakerPostWithOpenAI: vi.fn(async () => ({
      requestId: "req_caption",
      usage: null,
      bundle: {
        post: "🎙️ Speaker Spotlight: Joe Palermo\n\nVerified AGI Summit speaker.\n\n🔹 Leadership — Building useful AI systems\n🔹 Practice — Turning research into products\n🔹 Community — Supporting builders\n\nHear Joe on stage at AGI Summit SF 2026.\n\nJuly 18–19, 2026\nPalace of Fine Arts, San Francisco\nhttps://luma.com/agisummit2026?coupon=JAMES\n15% off automatically applied through the link\n\n#AGISummit #AI #Builders #SanFrancisco",
        warnings: [],
        factualClaimsUsed: []
      }
    })),
    speakerSpotlightImageWithOpenAI: providerMocks.image
  };
});

beforeEach(async () => {
  vi.stubEnv("MARKETING_HUB_DEMO_MODE", "false");
  resetAllData();
  const bytes = await sharp({ create: { width: 1024, height: 1536, channels: 4, background: "#080b24" } }).png().toBuffer();
  providerMocks.image.mockReset();
  providerMocks.image.mockResolvedValue({ bytes, requestId: "req_image_1" });
});

afterEach(() => {
  resetAllData();
  closeDatabase();
  vi.unstubAllEnvs();
});

describe("Speaker Spotlight face-only headshot gate", () => {
  it("allows cosmetic defects whenever a face is visible", () => {
    expect(headshotQaAllowsGeneration({ faceVisible: true })).toBe(true);
    expect(headshotQaAllowsGeneration({ faceVisible: false })).toBe(false);
  });
});

describe.skipIf(!hasExternalSpeakerSite)("Speaker Spotlight first-image output contract", () => {
  it("accepts the first valid image with no vision QA or automatic retry", async () => {
    const batch = await createSpeakerSpotlights({ speakerNames: ["Joe Palermo"] }, "sk-test-key");
    const result = batch.results[0];
    const imageInput = providerMocks.image.mock.calls[0][1] as { prompt: string; styleReferencePath: string };
    const imagePrompt = imageInput.prompt;

    expect(batch.promptVersion).toBe("speaker-spotlight-v7-palace-template");
    expect(result.status).toBe("completed");
    expect(result.retryCount).toBe(0);
    expect(providerMocks.image).toHaveBeenCalledTimes(1);
    expect(imagePrompt).toContain("Exact visible text, verbatim");
    expect(imagePrompt).toContain("canonical Yuandong Tian Palace of Fine Arts template");
    expect(imagePrompt).toContain("faded Palace of Fine Arts architecture behind the speaker");
    expect(imagePrompt).toContain("THE WORLD’S");
    expect(imagePrompt).toContain("LARGEST");
    expect(imagePrompt).toContain("ABOUT");
    expect(imagePrompt).toContain("preserve all fixed logos and fixed campaign copy");
    expect(imagePrompt).not.toContain("Image 3");
    expect(imagePrompt).toContain("July 18–19, 2026");
    expect(imageInput.styleReferencePath).toMatch(/speaker spotlight social media image reference v3\.png$/);
    expect(imageInput).not.toHaveProperty("organizationLogoPath");
    expect(result.requestIds).toEqual(["req_headshot_qa", "req_caption", "req_image_1"]);
    expect(result.qa).toMatchObject({
      imageValidationMode: "mechanical_only",
      imageAttempts: 1,
      imageTextVerified: null,
      identityVerified: null,
      humanReviewApprovedAt: null
    });
    expect(result.qa?.issues).toContain("Headshot source warning (generation continued): Rough background-removal artifacts around the hair and shoulders.");
    expect(result.qa?.imageAttemptResults).toEqual([{
      attempt: 1,
      imageRequestId: "req_image_1",
      qaRequestId: null,
      mechanicalChecksPassed: true,
      checks: null,
      approved: true,
      issues: []
    }]);
  });

  it("fails one malformed image without launching an automatic replacement", async () => {
    const bytes = await sharp({ create: { width: 512, height: 512, channels: 4, background: "#080b24" } }).png().toBuffer();
    providerMocks.image.mockResolvedValue({ bytes, requestId: "req_bad_image" });

    const batch = await createSpeakerSpotlights({ speakerNames: ["Joe Palermo"] }, "sk-test-key");
    const result = batch.results[0];

    expect(providerMocks.image).toHaveBeenCalledTimes(1);
    expect(batch.status).toBe("partially_completed");
    expect(result.status).toBe("failed");
    expect(result.post).toContain("Speaker Spotlight: Joe Palermo");
    expect(result.imageAssetId).toBeNull();
    expect(result.requestIds).toEqual(["req_headshot_qa", "req_caption", "req_bad_image"]);
    expect(result.providerError).toBeNull();
    expect(result.error).toContain("512×512 png, not 1024×1536 PNG");
    expect(result.error).toContain("No automatic image retry was started");
  });

  it("promotes a preserved first image from a canceled legacy run without another API call", async () => {
    const batch = await createSpeakerSpotlights({ speakerNames: ["Joe Palermo"] }, "sk-test-key");
    const original = batch.results[0];
    const speakerDirectory = path.join(process.env.MARKETING_HUB_DATA_DIR!, "speaker_spotlights", batch.id, "joe-palermo");
    const finalPath = path.join(speakerDirectory, "joe-palermo-speaker-spotlight.png");
    fs.rmSync(finalPath);
    updateSpeakerSpotlightResult(original.id, { status: "canceled", imageAssetId: null, imageFileName: null, qa: null, error: "Canceled during a legacy retry." });

    const imageCallsBeforePromotion = providerMocks.image.mock.calls.length;
    const approvedBatch = await approveSpeakerSpotlightImage(original.id);
    const approved = approvedBatch.results[0];

    expect(providerMocks.image).toHaveBeenCalledTimes(imageCallsBeforePromotion);
    expect(approvedBatch.status).toBe("completed");
    expect(approved.status).toBe("completed");
    expect(approved.imageFileName).toBe("joe-palermo-speaker-spotlight.png");
    expect(approved.imageAssetId).toEqual(expect.any(String));
    expect(approved.qa).toMatchObject({ imageValidationMode: "mechanical_only", imageAttempts: 1, humanReviewApprovedAt: expect.any(String) });
    expect(fs.existsSync(finalPath)).toBe(true);
  });
});
