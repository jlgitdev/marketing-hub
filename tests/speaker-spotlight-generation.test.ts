import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase } from "@/server/db/database";
import { resetAllData, speakerSpotlightResultStorage } from "@/server/db/repository";
import { createSpeakerSpotlights, headshotFaceCheckAllowsGeneration, retrySpeakerSpotlight } from "@/server/services/speaker-spotlight-service";

const providerMocks = vi.hoisted(() => ({ headshot: vi.fn(), post: vi.fn(), image: vi.fn() }));

vi.mock("@/server/ai/openai-provider", () => {
  class ProviderFailure extends Error {
    constructor(public code: string, message: string, public details = { status: null, providerCode: null, providerType: null, param: null, requestId: null, retryable: false, moderationStage: null, moderationCategories: [] as string[] }) { super(message); }
  }
  return {
    ProviderFailure,
    speakerHeadshotFaceCheckWithOpenAI: providerMocks.headshot,
    speakerPostWithOpenAI: providerMocks.post,
    speakerSpotlightImageWithOpenAI: providerMocks.image
  };
});

beforeEach(async () => {
  vi.stubEnv("MARKETING_HUB_DEMO_MODE", "false");
  resetAllData();
  const siteDirectory = fixtureSiteDirectory();
  fs.mkdirSync(siteDirectory, { recursive: true });
  fs.writeFileSync(path.join(siteDirectory, "index-speaker-fixture.js"), `const profiles={joepalermo:{sub:"AI researcher",roleLine:"AI researcher at Example Labs",bio:"Builds useful AI systems.",highlights:[{k:"Leadership",t:"Building useful AI systems"},{k:"Practice",t:"Turning research into products"},{k:"Community",t:"Supporting builders"}],industries:["Artificial intelligence"],stats:[],tags:["AI"]}};`);
  await sharp({ create: { width: 480, height: 640, channels: 4, background: "#8090a0" } }).png().toFile(path.join(siteDirectory, "joe-palermo.png"));
  providerMocks.headshot.mockReset().mockResolvedValue({ requestId: "req_headshot", bundle: { faceVisible: true } });
  providerMocks.post.mockReset().mockResolvedValue({
    requestId: "req_caption",
    usage: null,
    bundle: {
      post: "🎙️ Speaker Spotlight: Joe Palermo\n\nVerified AGI Summit speaker.\n\n🔹 Leadership — Building useful AI systems\n🔹 Practice — Turning research into products\n🔹 Community — Supporting builders\n\nHear Joe on stage at AGI Summit SF 2026.\n\nJuly 18–19, 2026\nPalace of Fine Arts, San Francisco\nhttps://luma.com/agisummit2026?coupon=JAMES\n15% off automatically applied through the link\n\n#AGISummit #AI #Builders #SanFrancisco",
      warnings: [],
      factualClaimsUsed: []
    }
  });
  providerMocks.image.mockReset();
  const bytes = await sharp({ create: { width: 1024, height: 1536, channels: 4, background: "#080b24" } }).png().toBuffer();
  providerMocks.image.mockResolvedValue({ bytes, requestId: "req_image_1" });
});

afterEach(() => {
  resetAllData();
  closeDatabase();
  vi.unstubAllEnvs();
});

describe("Speaker Spotlight source-headshot gate", () => {
  it("allows a matched source image whenever a face is visible", () => {
    expect(headshotFaceCheckAllowsGeneration({ faceVisible: true })).toBe(true);
    expect(headshotFaceCheckAllowsGeneration({ faceVisible: false })).toBe(false);
  });
});

describe("Speaker Spotlight one-image output contract", () => {
  it("saves the first generated image as completed without output inspection or an automatic retry", async () => {
    const batch = await createSpeakerSpotlights({ speakerNames: ["Joe Palermo"], config: { siteDirectory: fixtureSiteDirectory() } }, "sk-test-key");
    const result = batch.results[0];
    const imageInput = providerMocks.image.mock.calls[0][1] as { prompt: string; styleReferencePath: string };

    expect(batch.promptVersion).toBe("speaker-spotlight-v7-palace-template");
    expect(batch.status).toBe("completed");
    expect(result.status).toBe("completed");
    expect(result.retryCount).toBe(0);
    expect(providerMocks.image).toHaveBeenCalledTimes(1);
    expect(imageInput.prompt).toContain("Image 1 is the selected template");
    expect(imageInput.prompt).toContain("Image 2 is the verified identity reference");
    expect(imageInput.prompt).toContain("Template analysis:");
    expect(imageInput.prompt).toContain("Authorized visible text, verbatim:");
    expect(imageInput.prompt).not.toContain("Image 3");
    expect(imageInput.styleReferencePath).toMatch(/template-reference\.png$/);
    expect(result.requestIds).toEqual(["req_headshot", "req_caption", "req_image_1"]);
    expect(result).not.toHaveProperty("qa");
  });

  it("keeps a nonstandard first image instead of inspecting or automatically replacing it", async () => {
    const bytes = await sharp({ create: { width: 512, height: 512, channels: 4, background: "#080b24" } }).png().toBuffer();
    providerMocks.image.mockResolvedValue({ bytes, requestId: "req_bad_image" });

    const batch = await createSpeakerSpotlights({ speakerNames: ["Joe Palermo"], config: { siteDirectory: fixtureSiteDirectory() } }, "sk-test-key");
    const result = batch.results[0];

    expect(providerMocks.image).toHaveBeenCalledTimes(1);
    expect(batch.status).toBe("completed");
    expect(result.status).toBe("completed");
    expect(result.post).toContain("Speaker Spotlight: Joe Palermo");
    expect(result.imageAssetId).toEqual(expect.any(String));
    expect(result.requestIds).toEqual(["req_headshot", "req_caption", "req_bad_image"]);
    expect(result.providerError).toBeNull();
    expect(result.error).toBeNull();
    expect(result).not.toHaveProperty("qa");
    const stored = speakerSpotlightResultStorage(result.id);
    expect(await sharp(stored!.imagePath!).metadata()).toMatchObject({ width: 512, height: 512, format: "png" });
  });

  it("regenerates one completed speaker only when manually requested", async () => {
    const batch = await createSpeakerSpotlights({ speakerNames: ["Joe Palermo"], config: { siteDirectory: fixtureSiteDirectory() } }, "sk-test-key");
    const original = batch.results[0];
    const replacement = await sharp({ create: { width: 1024, height: 1536, channels: 4, background: "#442266" } }).png().toBuffer();
    providerMocks.image.mockResolvedValueOnce({ bytes: replacement, requestId: "req_image_2" });

    const regeneratedBatch = await retrySpeakerSpotlight(original.id, "sk-test-key");
    const regenerated = regeneratedBatch.results[0];

    expect(providerMocks.image).toHaveBeenCalledTimes(2);
    expect(providerMocks.headshot).toHaveBeenCalledTimes(1);
    expect(providerMocks.post).toHaveBeenCalledTimes(1);
    expect(regeneratedBatch.status).toBe("completed");
    expect(regenerated).toMatchObject({ status: "completed", retryCount: 1, post: original.post });
    expect(regenerated.imageAssetId).not.toBe(original.imageAssetId);
    expect(regenerated.requestIds).toEqual(["req_headshot", "req_caption", "req_image_1", "req_image_2"]);
  });
});

function fixtureSiteDirectory() {
  return path.join(process.env.MARKETING_HUB_DATA_DIR!, "speaker-site-fixture");
}
