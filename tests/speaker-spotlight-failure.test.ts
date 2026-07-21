import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase } from "@/server/db/database";
import { resetAllData } from "@/server/db/repository";
import { createSpeakerSpotlights } from "@/server/services/speaker-spotlight-service";
import { hasExternalSpeakerSite } from "./external-speaker-site";

vi.mock("@/server/ai/openai-provider", () => {
  const emptyDetails = () => ({ status: null, providerCode: null, providerType: null, param: null, requestId: null, retryable: false, moderationStage: null, moderationCategories: [] as string[] });
  class ProviderFailure extends Error {
    constructor(public code: string, message: string, public details: { status: number | null; providerCode: string | null; providerType: string | null; param: string | null; requestId: string | null; retryable: boolean; moderationStage: string | null; moderationCategories: string[] } = emptyDetails()) { super(message); }
  }
  return {
    ProviderFailure,
    speakerHeadshotFaceCheckWithOpenAI: vi.fn(async () => ({
      requestId: "req_headshot_face_check",
      bundle: { faceVisible: true, approved: true, singlePerson: true, usablePortrait: true, notLogoGraphicOrThumbnail: true, notVisiblyCorrupted: true, issues: [] }
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
    speakerSpotlightImageWithOpenAI: vi.fn(async () => {
      throw new ProviderFailure("invalid_request", "OpenAI rejected the request (code invalid_value, parameter input_fidelity). OpenAI request: req_image_edit.", {
        status: 400,
        providerCode: "invalid_value",
        providerType: "invalid_request_error",
        param: "input_fidelity",
        requestId: "req_image_edit",
        retryable: false,
        moderationStage: null,
        moderationCategories: []
      });
    })
  };
});

beforeEach(() => {
  vi.stubEnv("MARKETING_HUB_DEMO_MODE", "false");
  resetAllData();
});

afterEach(() => {
  resetAllData();
  closeDatabase();
  vi.unstubAllEnvs();
});

describe.skipIf(!hasExternalSpeakerSite)("Speaker Spotlight partial-result preservation", () => {
  it("persists the verified caption and actionable image-stage diagnostics when the edit fails", async () => {
    const batch = await createSpeakerSpotlights({ speakerNames: ["Joe Palermo"] }, "sk-test-key");
    const result = batch.results[0];

    expect(batch.status).toBe("partially_completed");
    expect(result.status).toBe("failed");
    expect(result.post).toContain("Speaker Spotlight: Joe Palermo");
    expect(result.imageAssetId).toBeNull();
    expect(result.requestIds).toEqual(["req_headshot_face_check", "req_caption", "req_image_edit"]);
    expect(result.providerError).toMatchObject({
      stage: "image_edit",
      code: "invalid_request",
      status: 400,
      providerCode: "invalid_value",
      param: "input_fidelity",
      requestId: "req_image_edit",
      retryable: false
    });
  });
});
