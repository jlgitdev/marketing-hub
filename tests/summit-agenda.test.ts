import fs from "node:fs";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, getDatabase } from "@/server/db/database";
import { resetAllData, summitAgendaAssetStoragePath } from "@/server/db/repository";
import { stripC2pa } from "@/server/images/strip-c2pa";
import { createSummitAgendaPosts, getSummitAgendaWorkspace, resetSummitAgendaSession, saveSummitAgendaPortrait, updateSummitAgendaSession } from "@/server/services/summit-agenda-service";
import { ProviderFailure } from "@/server/ai/openai-provider";
import { OperationCanceledError } from "@/server/operations/types";
import { buildSummitAgendaCaption } from "@/lib/summit-agenda-caption";

const providerMocks = vi.hoisted(() => ({ agendaImage: vi.fn() }));

vi.mock("@/server/ai/openai-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/ai/openai-provider")>()),
  summitAgendaImageWithOpenAI: providerMocks.agendaImage
}));

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
  it("deterministically matches the supplied live-caption templates", () => {
    const { agenda } = getSummitAgendaWorkspace();
    const sessions = agenda.days.flatMap((day) => day.sessions);
    const panel = sessions.find((session) => session.title.startsWith("When AI Agents Go to Work"))!;
    const fireside = sessions.find((session) => session.title === "Shipping AI Dev Tools Across Hundreds of Engineers")!;
    const solo = sessions.find((session) => session.title === "AI Can Write PRs end-to-end, Should It?")!;

    expect(buildSummitAgendaCaption(panel, agenda.event)).toBe(`🔴 Coming up live at AGI Summit in San Francisco!

“When AI Agents Go to Work—Building, Trusting & Scaling Autonomous AI”

🎙️ Moderator: Zihan Wang
💬 Charlie Hu, Emery Han, Li Erran Li, Chi Zhang, Xuewei Wu & Henry Kang
🕠 5:25–5:55 PM

#AGISummit #AIAgents #AutonomousAI #ArtificialIntelligence #SanFrancisco`);
    expect(buildSummitAgendaCaption(fireside, agenda.event)).toBe(`🔴 LIVE at AGI Summit

“Shipping AI Dev Tools Across Hundreds of Engineers”

🔥 Daksh Gupta & Chintan Turakhia
🕘 9:20–9:40 AM
📍 San Francisco

#AGISummit #AI #DeveloperTools #Engineering #SanFrancisco`);
    expect(buildSummitAgendaCaption(solo, agenda.event)).toBe(`🔴 LIVE at AGI Summit

“AI Can Write PRs End-to-End, Should It?”

🎤 Daksh Gupta
🕘 8:40–9:00 AM
📍 San Francisco

#AGISummit #AI #SoftwareDevelopment`);
  });

  it("handles duplicate names, multiple moderators, and time-period boundaries", () => {
    const source = getSummitAgendaWorkspace().agenda.days[0].sessions.find((session) => session.people.length >= 2)!;
    const caption = buildSummitAgendaCaption({
      ...source,
      format: "Talk",
      title: "  privacy   and AI infrastructure  ",
      start: 710,
      end: 730,
      people: [
        { ...source.people[0], name: "  Alex Smith ", moderator: true },
        { ...source.people[1], name: "Jamie Lee", moderator: true },
        { ...source.people[0], id: "duplicate", name: "alex smith", moderator: false },
        { ...source.people[1], id: "speaker", name: "  Pat  Jones ", moderator: false },
        { ...source.people[1], id: "speaker-duplicate", name: "pat jones", moderator: false }
      ]
    }, { name: "AGI Summit SF 2026", location: "San Francisco" });

    expect(caption).toContain("🎙️ Moderators: Alex Smith & Jamie Lee");
    expect(caption).toContain("💬 Pat Jones");
    expect(caption).not.toContain("💬 alex smith");
    expect(caption).toContain("🕛 11:50 AM–12:10 PM");
    expect(caption).toContain("#Cybersecurity #AIInfrastructure");
  });

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
    const { batch } = await createSummitAgendaPosts({ sessionIds: [session.id] }, null);
    expect(batch).toMatchObject({ status: "completed", provider: "demo" });
    expect(batch.results[0]).toMatchObject({ status: "completed", imageAssetId: expect.any(String), caption: expect.stringContaining("🔴 LIVE at AGI Summit") });
    expect(getSummitAgendaWorkspace().batches[0].results[0].caption).toBe(batch.results[0].caption);
    getDatabase().prepare("UPDATE summit_agenda_results SET caption=NULL WHERE id=?").run(batch.results[0].id);
    expect(getSummitAgendaWorkspace().batches[0].results[0].caption).toBe(batch.results[0].caption);
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

    const { batch } = await createSummitAgendaPosts({ sessionIds: [session.id] }, "sk-test-key");
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
    const { batch } = await createSummitAgendaPosts({ sessionIds: [session.id] }, null);
    const storedPath = summitAgendaAssetStoragePath(batch.results[0].imageAssetId!)!;
    const legacyFullCanvasPath = storedPath.replace(/-live\.png$/i, "-provider.png");
    await sharp({ create: { width: 1024, height: 1536, channels: 4, background: "#080b24" } }).png().toFile(legacyFullCanvasPath);

    expect(summitAgendaAssetStoragePath(batch.results[0].imageAssetId!)).toBe(legacyFullCanvasPath);
  }, 20_000);

  it("continues after a retryable image failure and resumes only the preserved failed snapshot", async () => {
    vi.stubEnv("MARKETING_HUB_DEMO_MODE", "false");
    const bytes = await sharp({ create: { width: 1024, height: 1536, channels: 4, background: "#080b24" } }).png().toBuffer();
    const sessions = getSummitAgendaWorkspace().agenda.days[0].sessions.filter((session) => session.title && session.people.length && session.people.every((person) => person.photo)).slice(0, 2);
    const timeout = new ProviderFailure("timeout", "The OpenAI request timed out. Retry the preserved package.", {
      status: null, providerCode: null, providerType: null, param: null, requestId: null, retryable: true, moderationStage: null, moderationCategories: []
    });
    providerMocks.agendaImage.mockRejectedValueOnce(timeout).mockResolvedValueOnce({ bytes, requestId: "req_second" });
    const progress = vi.fn();
    const controller = new AbortController();

    const execution = await createSummitAgendaPosts({ sessionIds: sessions.map((session) => session.id) }, "sk-test-key", {
      signal: controller.signal, stage: vi.fn(), checkpoint: vi.fn(), progress
    });

    expect(providerMocks.agendaImage).toHaveBeenCalledTimes(2);
    expect(execution.batch.results.map((result) => result.status)).toEqual(["failed", "completed"]);
    expect(execution.batch.results[0].providerError).toMatchObject({ code: "timeout", retryable: true });
    expect(progress.mock.calls.map((call) => call[0])).toEqual([1, 2]);
    expect(execution.retryInput?.resultIds).toEqual([execution.batch.results[0].id]);

    updateSummitAgendaSession({
      sessionId: sessions[0].id, title: "Changed after the original run", format: sessions[0].format as "Keynote" | "Fireside" | "Panel" | "Workshop" | "Talk" | "Break",
      start: sessions[0].start, end: sessions[0].end, people: sessions[0].people
    });
    providerMocks.agendaImage.mockReset();
    providerMocks.agendaImage.mockResolvedValue({ bytes, requestId: "req_retry" });
    const retried = await createSummitAgendaPosts(execution.retryInput!, "sk-test-key");

    expect(providerMocks.agendaImage).toHaveBeenCalledTimes(1);
    expect(retried.batch.results).toHaveLength(1);
    expect(retried.batch.results[0]).toMatchObject({ status: "completed", session: { title: sessions[0].title } });
  }, 20_000);

  it("makes the active and queued results terminal when a batch is canceled", async () => {
    vi.stubEnv("MARKETING_HUB_DEMO_MODE", "false");
    const sessions = getSummitAgendaWorkspace().agenda.days[0].sessions.filter((session) => session.title && session.people.length && session.people.every((person) => person.photo)).slice(0, 2);
    const controller = new AbortController();
    providerMocks.agendaImage.mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    });

    const pending = createSummitAgendaPosts({ sessionIds: sessions.map((session) => session.id) }, "sk-test-key", {
      signal: controller.signal, stage: vi.fn(), checkpoint: vi.fn(), progress: vi.fn()
    });
    await expect(pending).rejects.toBeInstanceOf(OperationCanceledError);

    const batch = getSummitAgendaWorkspace().batches[0];
    expect(batch.results.map((result) => result.status)).toEqual(["canceled", "canceled"]);
    expect(batch.results.every((result) => result.error?.includes("Canceled"))).toBe(true);
  });
});
