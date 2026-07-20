import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getSummitAgendaAsset } from "@/app/api/summit-agenda/asset/route";
import { GET as getSummitAgendaPortrait } from "@/app/api/summit-agenda/portrait/route";
import { dataDirectory } from "@/server/config";
import {
  createSpeakerSpotlightBatch,
  createSummitAgendaBatch,
  getSpeakerSpotlightBatch,
  getSummitAgendaBatch,
  getWorkspaceState,
  listSpeakerSpotlightBatchSummaries,
  listSummitAgendaBatchSummaries,
  resetAllData,
  updateSummitAgendaResult
} from "@/server/db/repository";
import { closeDatabase } from "@/server/db/database";
import { getSummitAgendaView } from "@/server/services/summit-agenda-service";
import { renderWebpPreview } from "@/server/images/preview";

beforeEach(() => resetAllData());
afterEach(() => { resetAllData(); closeDatabase(); });

describe("performance-safe data views", () => {
  it("keeps full batch results available while the global workspace carries summaries only", () => {
    const now = "2026-07-20T12:00:00.000Z";
    const speakerBatchId = "00000000-0000-4000-8000-000000000101";
    createSpeakerSpotlightBatch({
      id: speakerBatchId, speakerNames: ["Ada Example"], status: "completed",
      config: { eventName: "AGI Summit", eventDates: "July 18–19", eventVenue: "San Francisco", eventWebsite: "agisummit.ai", ticketUrl: "https://example.com", discountCopy: "Test", siteDirectory: "/tmp" },
      model: "demo", promptVersion: "test", provider: "demo", warnings: [], error: null, createdAt: now, completedAt: now,
      results: [{ id: "00000000-0000-4000-8000-000000000102", batchId: speakerBatchId, inputName: "Ada Example", profileKey: "adaexample", slug: "ada-example", status: "completed", profile: null, post: "Caption", headshotFileName: null, imageFileName: null, headshotAssetId: null, imageAssetId: null, imagePrompt: null, qa: null, requestIds: [], retryCount: 0, providerError: null, error: null, createdAt: now, updatedAt: now }]
    });

    const agendaBatchId = "00000000-0000-4000-8000-000000000103";
    const session = { id: "session-1", sourceId: "source-1", day: "day1" as const, stage: "gpt" as const, stageName: "GPT Stage", start: 540, end: 560, startLabel: "9:00", endLabel: "9:20", format: "Talk", title: "A session", status: "published", relation: "", notified: false, people: [] };
    createSummitAgendaBatch({
      id: agendaBatchId, sessionIds: [session.id], status: "completed", model: "demo", promptVersion: "test", provider: "demo", warnings: [], error: null, createdAt: now, completedAt: now,
      results: [{ id: "00000000-0000-4000-8000-000000000104", batchId: agendaBatchId, sessionId: session.id, session, status: "completed", imageAssetId: null, imageFileName: null, caption: "Caption", prompt: null, requestId: null, providerError: null, error: null, createdAt: now, updatedAt: now }]
    });

    expect(listSpeakerSpotlightBatchSummaries()[0]).toMatchObject({ id: speakerBatchId, completedCount: 1, resultCount: 1 });
    expect(listSummitAgendaBatchSummaries()[0]).toMatchObject({ id: agendaBatchId, completedCount: 1, resultCount: 1 });
    expect(getSpeakerSpotlightBatch(speakerBatchId)?.results).toHaveLength(1);
    expect(getSummitAgendaBatch(agendaBatchId)?.results).toHaveLength(1);

    const workspace = getWorkspaceState({ connected: true, source: "demo", suffix: null, state: "connected", message: "Demo" });
    expect(workspace.speakerSpotlightBatches[0]).not.toHaveProperty("results");
    expect(workspace.summitAgendaBatches[0]).not.toHaveProperty("results");
    expect(workspace.counts).toMatchObject({ speakerSpotlights: 1, summitAgendaPosts: 1 });

    const agendaView = getSummitAgendaView(agendaBatchId);
    expect(agendaView.batch?.results).toHaveLength(1);
    expect(agendaView.batches[0]).not.toHaveProperty("results");
  });

  it("produces a small WebP derivative without changing the source aspect ratio", async () => {
    const source = await sharp({ create: { width: 1254, height: 1000, channels: 4, background: "#526bd3" } }).png().toBuffer();
    const preview = await renderWebpPreview(source, 56);
    const metadata = await sharp(preview).metadata();

    expect(metadata).toMatchObject({ format: "webp", width: 56, height: 45 });
    expect(preview.length).toBeLessThan(source.length);
  });

  it("serves lightweight previews while preserving original portrait and agenda downloads", async () => {
    const agenda = getSummitAgendaView().agenda;
    const portraitToken = agenda.days.flatMap((day) => day.sessions).flatMap((session) => session.people).find((person) => person.photo)?.photo;
    expect(portraitToken).toBeTruthy();

    const portraitPreviewResponse = await getSummitAgendaPortrait(new Request(`http://localhost/api/summit-agenda/portrait?token=${encodeURIComponent(portraitToken!)}&size=56`));
    const portraitPreview = Buffer.from(await portraitPreviewResponse.arrayBuffer());
    expect(portraitPreviewResponse.headers.get("content-type")).toBe("image/webp");
    expect((await sharp(portraitPreview).metadata()).width).toBe(56);

    const now = "2026-07-20T12:00:00.000Z";
    const batchId = "00000000-0000-4000-8000-000000000201";
    const resultId = "00000000-0000-4000-8000-000000000202";
    const assetId = "00000000-0000-4000-8000-000000000203";
    const session = { id: "session-preview", sourceId: "source-preview", day: "day1" as const, stage: "gpt" as const, stageName: "GPT Stage", start: 540, end: 560, startLabel: "9:00", endLabel: "9:20", format: "Talk", title: "Preview route", status: "published", relation: "", notified: false, people: [] };
    createSummitAgendaBatch({
      id: batchId, sessionIds: [session.id], status: "completed", model: "demo", promptVersion: "test", provider: "demo", warnings: [], error: null, createdAt: now, completedAt: now,
      results: [{ id: resultId, batchId, sessionId: session.id, session, status: "completed", imageAssetId: assetId, imageFileName: "preview-route.png", caption: "Caption", prompt: null, requestId: null, providerError: null, error: null, createdAt: now, updatedAt: now }]
    });
    const storagePath = path.join(dataDirectory(), "summit_agenda", batchId, "preview-route.png");
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    const original = await sharp({ create: { width: 1080, height: 1440, channels: 4, background: "#d8873d" } }).png().toBuffer();
    fs.writeFileSync(storagePath, original);
    updateSummitAgendaResult(resultId, { imageStoragePath: storagePath });

    const previewResponse = await getSummitAgendaAsset(new Request(`http://localhost/api/summit-agenda/asset?id=${assetId}&preview=1`));
    const preview = Buffer.from(await previewResponse.arrayBuffer());
    expect(previewResponse.headers.get("content-type")).toBe("image/webp");
    expect(await sharp(preview).metadata()).toMatchObject({ format: "webp", width: 720, height: 960 });
    expect(preview.length).toBeLessThan(original.length);

    const downloadResponse = await getSummitAgendaAsset(new Request(`http://localhost/api/summit-agenda/asset?id=${assetId}&download=1`));
    const download = Buffer.from(await downloadResponse.arrayBuffer());
    expect(downloadResponse.headers.get("content-type")).toBe("image/png");
    expect(downloadResponse.headers.get("content-disposition")).toContain("attachment");
    expect(await sharp(download).metadata()).toMatchObject({ format: "png", width: 1080, height: 1440 });
  });
});
