import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agiSummitSiteDirectory, projectContextDirectory } from "@/server/config";
import { closeDatabase } from "@/server/db/database";
import { createContextDocument, listContextDocuments, resetAllData, updateSpeakerSpotlightResult } from "@/server/db/repository";
import { deriveContextMetadata, ensureProjectContextImported, selectRelevantContext } from "@/server/services/context-service";
import { createSpeakerSpotlights, extractSpeakerProfile, resolveSpeakerOrganizationBrand, retrySpeakerSpotlight } from "@/server/services/speaker-spotlight-service";
import { hasExternalSpeakerSite } from "./external-speaker-site";

beforeEach(() => resetAllData());
afterEach(() => { resetAllData(); closeDatabase(); vi.unstubAllEnvs(); });

describe("flexible project context", () => {
  it("classifies every supplied Markdown asset without a fixed category enum and recognizes the AGI source of truth", () => {
    const files = fs.readdirSync(projectContextDirectory()).filter((name) => name.endsWith(".md"));
    expect(files.length).toBeGreaterThanOrEqual(5);
    const metadata = files.map((name) => deriveContextMetadata(name.replace(/\.md$/, ""), fs.readFileSync(path.join(projectContextDirectory(), name), "utf8"), path.join(projectContextDirectory(), name)));
    expect(metadata.find((item) => item.sourceOfTruth)).toMatchObject({ type: "event_information", purposes: expect.arrayContaining(["research", "outreach", "content", "speaker_spotlight"]) });
    expect(metadata.find((item) => item.platforms.includes("x") && item.type === "platform_guidance")).toMatchObject({ type: "platform_guidance" });
    expect(metadata.filter((item) => item.purposes.includes("speaker_spotlight")).length).toBeGreaterThanOrEqual(3);
  });

  it("imports the supplied project assets into a live workspace with open metadata", () => {
    vi.stubEnv("MARKETING_HUB_DEMO_MODE", "false");
    ensureProjectContextImported();
    const documents = listContextDocuments();
    expect(documents.map((document) => document.title)).toEqual(expect.arrayContaining([
      "agi summit information (1)", "x_twitter_event_marketing_playbook_agi_summit (1)", "Speaker Spotlight Creation Guide"
    ]));
    expect(documents.find((document) => document.sourceOfTruth)).toMatchObject({ type: "event_information", origin: "project_asset" });
    expect(documents.every((document) => document.summary && document.tags.length && document.purposes.length)).toBe(true);
  });

  it("automatically ranks relevant local guidance and reports only missing platform guidance for web fallback", () => {
    const event = deriveContextMetadata("AGI Summit information", "# AGI Summit information\nOfficial dates and venue for AGI Summit.");
    const xGuide = deriveContextMetadata("X Twitter event marketing playbook", "# X / Twitter\nHow to create an X post with strong engagement.");
    createContextDocument({ title: "AGI Summit information", body: "Official AGI Summit dates and venue.", ...event, active: true, notes: "", origin: "user", sourcePath: null, contentHash: null });
    createContextDocument({ title: "X Twitter event marketing playbook", body: "Current X post writing and image guidance.", ...xGuide, active: true, notes: "", origin: "user", sourcePath: null, contentHash: null });
    const selection = selectRelevantContext({ workflow: "content", query: "Create social posts for AGI Summit", platforms: ["x", "linkedin"], automatic: true });
    expect(selection.documents.map((document) => document.title)).toEqual(expect.arrayContaining(["AGI Summit information", "X Twitter event marketing playbook"]));
    expect(selection.missingPlatformGuidance).toEqual(["linkedin"]);
  });
});

describe.skipIf(!hasExternalSpeakerSite)("Speaker Spotlight workflow", () => {
  it("extracts a verified profile from the downloaded bundle and completes an isolated demo package", async () => {
    resetAllData();
    const bundle = fs.readdirSync(agiSummitSiteDirectory(), { recursive: true }).map(String).find((name) => /index-.*\.js$/i.test(name));
    expect(bundle).toBeTruthy();
    const bundlePath = path.join(agiSummitSiteDirectory(), bundle!);
    const profile = extractSpeakerProfile("Joe Palermo", bundlePath);
    expect(profile).toMatchObject({ displayName: "Joe Palermo", profileKey: "joepalermo", source: { verified: true } });
    expect(profile.highlights.length).toBeGreaterThanOrEqual(3);

    const batch = await createSpeakerSpotlights({ speakerNames: ["Joe Palermo", "Aengus Lynch", "Zihan Wang", "Jeremiah Owyang"] }, null);
    expect(batch.status).toBe("completed");
    expect(batch.results[0]).toMatchObject({ status: "completed", post: expect.stringContaining("Speaker Spotlight: Joe Palermo"), imageAssetId: expect.any(String) });
    expect(batch.results[1]).toMatchObject({ status: "completed", profileKey: "aenguslynch", imageAssetId: expect.any(String) });
    expect(batch.results[2]).toMatchObject({ status: "completed", profileKey: "zihanwang", headshotAssetId: expect.any(String), imageAssetId: expect.any(String) });
    expect(batch.results[3]).toMatchObject({ status: "completed", profileKey: "jeremiahowyang", headshotAssetId: expect.any(String), imageAssetId: expect.any(String) });
    const imagePath = path.join(process.env.MARKETING_HUB_DATA_DIR || ".marketing-hub", "speaker_spotlights", batch.id, "joe-palermo", "joe-palermo-speaker-spotlight.png");
    const metadata = await sharp(path.resolve(imagePath)).metadata();
    expect(metadata).toMatchObject({ width: 1024, height: 1536, format: "png" });
  }, 30_000);

  it("resolves the website's organization branding and gives Marco Pavone the NVIDIA lockup", () => {
    const bundle = fs.readdirSync(agiSummitSiteDirectory(), { recursive: true }).map(String).find((name) => /index-.*\.js$/i.test(name));
    expect(bundle).toBeTruthy();
    const bundlePath = path.join(agiSummitSiteDirectory(), bundle!);
    const marco = extractSpeakerProfile("Marco Pavone", bundlePath);
    const joe = extractSpeakerProfile("Joe Palermo", bundlePath);

    expect(resolveSpeakerOrganizationBrand(marco, bundlePath, agiSummitSiteDirectory())).toMatchObject({
      name: "NVIDIA",
      sourceFileName: expect.stringMatching(/nvidia.*\.png$/i)
    });
    expect(resolveSpeakerOrganizationBrand(joe, bundlePath, agiSummitSiteDirectory())).toMatchObject({
      name: "OpenAI",
      sourceFileName: expect.stringMatching(/openai.*\.svg$/i)
    });
  });

  it("resolves verified opaque headshot filenames from the live-page manifest", async () => {
    const batch = await createSpeakerSpotlights({ speakerNames: ["Rohan Varma", "Raymond Chen", "Christopher Manning"] }, null);

    expect(batch.status).toBe("completed");
    expect(batch.results).toHaveLength(3);
    expect(batch.results.map((result) => result.status)).toEqual(["completed", "completed", "completed"]);
    expect(batch.results.map((result) => result.profileKey)).toEqual(["rohanvarma", "raymondchen", "christophermanning"]);
    expect(batch.results.every((result) => Boolean(result.headshotAssetId && result.imageAssetId))).toBe(true);
  }, 30_000);

  it("retries a preserved package without repeating profile or headshot extraction", async () => {
    const batch = await createSpeakerSpotlights({ speakerNames: ["Joe Palermo"] }, null);
    const original = batch.results[0];
    updateSpeakerSpotlightResult(original.id, { status: "failed", error: "Controlled image failure", providerError: null });

    const retried = await retrySpeakerSpotlight(original.id, null);
    const result = retried.results[0];

    expect(retried.status).toBe("completed");
    expect(result).toMatchObject({ status: "completed", profileKey: original.profileKey, headshotAssetId: original.headshotAssetId, retryCount: 1, providerError: null });
    expect(result.post).toContain("Speaker Spotlight: Joe Palermo");
    expect(result.imageAssetId).toEqual(expect.any(String));
  }, 30_000);
});
