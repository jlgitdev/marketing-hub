import fs from "node:fs";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase } from "@/server/db/database";
import { resetAllData, summitAgendaAssetStoragePath } from "@/server/db/repository";
import { stripC2pa } from "@/server/images/strip-c2pa";
import { createSummitAgendaPosts, getSummitAgendaWorkspace, resetSummitAgendaSession, saveSummitAgendaPortrait, updateSummitAgendaSession } from "@/server/services/summit-agenda-service";

const providerMocks = vi.hoisted(() => ({ agendaImage: vi.fn() }));

vi.mock("@/server/ai/openai-provider", () => ({ summitAgendaImageWithOpenAI: providerMocks.agendaImage }));

beforeEach(() => {
  providerMocks.agendaImage.mockReset();
  resetAllData();
});
afterEach(() => {
  resetAllData();
  closeDatabase();
  vi.unstubAllEnvs();
});

describe("live summit agenda", () => {
  it("preserves the rendered Day 1 and Day 2 calendars and known source records", () => {
    const { agenda } = getSummitAgendaWorkspace();
    expect(agenda.days.map((day) => day.sessions.length)).toEqual([63, 49]);
    expect(agenda.days[0].sessions.filter((session) => session.stage === "gpt")).toHaveLength(23);
    expect(agenda.days[1].sessions.filter((session) => session.stage === "workshop")).toHaveLength(1);
    expect(agenda.days[0].sessions.find((session) => session.startLabel === "8:40" && session.stage === "gpt")).toMatchObject({
      title: "AI Can Write PRs end-to-end, Should It?",
      endLabel: "9:00",
      format: "Keynote",
      people: [{ name: "Daksh Gupta", photo: expect.stringMatching(/^default:/) }]
    });
    expect(agenda.days[0].sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(agenda.days[1].sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("stores modular edits and can restore the exact downloaded card", () => {
    const source = getSummitAgendaWorkspace().agenda.days[0].sessions.find((session) => session.startLabel === "9:20" && session.stage === "gpt")!;
    updateSummitAgendaSession({
      sessionId: source.id, title: "Edited title", format: "Panel", start: source.start, end: source.end,
      people: [...source.people, { id: "custom-test", name: "Added Person", role: "Host", company: "AGI Summit", moderator: false, photo: null }]
    });
    const edited = getSummitAgendaWorkspace().agenda.days[0].sessions.find((session) => session.id === source.id)!;
    expect(edited).toMatchObject({ title: "Edited title", format: "Panel" });
    expect(edited.people.at(-1)?.name).toBe("Added Person");
    resetSummitAgendaSession(source.id);
    const restored = getSummitAgendaWorkspace().agenda.days[0].sessions.find((session) => session.id === source.id)!;
    expect(restored).toEqual(source);
  });

  it("accepts a replacement portrait and stores a durable custom asset token", async () => {
    const session = getSummitAgendaWorkspace().agenda.days[0].sessions.find((item) => item.startLabel === "8:40" && item.stage === "gpt")!;
    const person = session.people[0];
    const sourcePath = `public/summit-agenda/portraits/${person.photo!.split(":", 2)[1]}`;
    const file = new File([fs.readFileSync(sourcePath)], "replacement.webp", { type: "image/webp" });
    const agenda = await saveSummitAgendaPortrait({ sessionId: session.id, personId: person.id, file });
    const updated = agenda.days[0].sessions.find((item) => item.id === session.id)!.people[0];
    expect(updated.photo).toMatch(/^custom:[a-f0-9-]+\.webp$/);
    expect(fs.existsSync(`${process.env.MARKETING_HUB_DATA_DIR}/summit_agenda/custom_portraits/${updated.photo!.split(":", 2)[1]}`)).toBe(true);
  });

  it("creates a first-pass 3:4 demo image and leaves it C2PA-free", async () => {
    const session = getSummitAgendaWorkspace().agenda.days[0].sessions.find((item) => item.startLabel === "8:40" && item.stage === "gpt")!;
    const batch = await createSummitAgendaPosts({ sessionIds: [session.id] }, null);
    expect(batch).toMatchObject({ status: "completed", provider: "demo" });
    expect(batch.results[0]).toMatchObject({ status: "completed", imageAssetId: expect.any(String) });
    const imagePath = summitAgendaAssetStoragePath(batch.results[0].imageAssetId!);
    expect(imagePath && fs.existsSync(imagePath)).toBe(true);
    const metadata = await sharp(imagePath!).metadata();
    expect(metadata).toMatchObject({ width: 1080, height: 1440, format: "png" });
    expect(stripC2pa(fs.readFileSync(imagePath!)).removedItems).toBe(0);
  }, 20_000);

  it("saves the provider's first canvas without cropping, resizing, or retrying", async () => {
    vi.stubEnv("MARKETING_HUB_DEMO_MODE", "false");
    const bytes = await sharp({ create: { width: 900, height: 1400, channels: 4, background: "#080b24" } }).png().toBuffer();
    providerMocks.agendaImage.mockResolvedValue({ bytes, requestId: "req_agenda_3x4" });
    const session = getSummitAgendaWorkspace().agenda.days[0].sessions.find((item) => item.startLabel === "8:40" && item.stage === "gpt")!;

    const batch = await createSummitAgendaPosts({ sessionIds: [session.id] }, "sk-test-key");
    const imagePath = summitAgendaAssetStoragePath(batch.results[0].imageAssetId!);
    const metadata = await sharp(imagePath!).metadata();

    expect(providerMocks.agendaImage).toHaveBeenCalledTimes(1);
    expect(batch).toMatchObject({ status: "completed", promptVersion: "summit-agenda-live-v3-3x4" });
    expect(batch.results[0]).toMatchObject({ status: "completed", requestId: "req_agenda_3x4" });
    expect(metadata).toMatchObject({ width: 900, height: 1400, format: "png" });
    expect(fs.readFileSync(imagePath!)).toEqual(bytes);
    expect(batch.results[0].prompt).toContain("3:4");
    expect(batch.results[0].prompt).not.toContain("center-crop");
  }, 20_000);

  it("serves the retained full provider canvas for legacy cropped runs", async () => {
    const session = getSummitAgendaWorkspace().agenda.days[0].sessions.find((item) => item.startLabel === "8:40" && item.stage === "gpt")!;
    const batch = await createSummitAgendaPosts({ sessionIds: [session.id] }, null);
    const storedPath = summitAgendaAssetStoragePath(batch.results[0].imageAssetId!)!;
    const legacyFullCanvasPath = storedPath.replace(/-live\.png$/i, "-provider.png");
    await sharp({ create: { width: 1024, height: 1536, channels: 4, background: "#080b24" } }).png().toFile(legacyFullCanvasPath);

    expect(summitAgendaAssetStoragePath(batch.results[0].imageAssetId!)).toBe(legacyFullCanvasPath);
  }, 20_000);
});
