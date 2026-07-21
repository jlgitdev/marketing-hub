import fs from "node:fs";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase } from "@/server/db/database";
import { listSpeakerSpotlightTemplates, resetAllData, speakerSpotlightTemplateStorage } from "@/server/db/repository";
import {
  analyzeSpeakerSpotlightTemplate,
  createPendingSpeakerSpotlightTemplate,
  deleteSpeakerSpotlightTemplate,
  ensureDefaultSpeakerSpotlightTemplate,
  readySpeakerSpotlightTemplate,
  selectTemplate,
  speakerSpotlightTemplateSnapshot
} from "@/server/services/speaker-spotlight-template-service";

beforeEach(() => resetAllData());
afterEach(() => { resetAllData(); closeDatabase(); });

async function reference(width = 900, height = 1200, color = "#26135f") {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
}

const guidance = {
  exampleSpeakerName: "Example Person",
  fixedGuidance: "Keep the summit logo, campaign headline, background, footer, and palette fixed.",
  variableGuidance: "Replace the portrait, speaker name, role, highlights, biography, and event details.",
  captionGuidance: "Use a concise future-facing opening tied to the visual series.",
  additionalGuidance: "Keep generous safe margins and a large portrait crop."
};

describe("versioned Speaker Spotlight templates", () => {
  it("removes retired output-review and pixel-restoration columns from the active database", () => {
    const resultColumns = getDatabase().prepare("PRAGMA table_info(speaker_spotlight_results)").all() as Array<{ name: string }>;
    const templateColumns = getDatabase().prepare("PRAGMA table_info(speaker_spotlight_templates)").all() as Array<{ name: string }>;
    expect(resultColumns.map((column) => column.name)).not.toContain("qa");
    expect(templateColumns.map((column) => column.name)).not.toContain("exact_pixel_regions");
  });

  it("normalizes, analyzes, selects, snapshots, and deletes a reusable template", async () => {
    const pending = await createPendingSpeakerSpotlightTemplate({ ...guidance, name: "Editorial Neon", fileName: "reference.jpg", bytes: await reference() });
    expect(pending).toMatchObject({ status: "analyzing", version: 1, selected: false, width: 1024, height: 1536, aspectRatio: "2:3" });
    const storage = speakerSpotlightTemplateStorage(pending.id)!;
    expect(fs.existsSync(storage.storagePath)).toBe(true);
    expect(fs.existsSync(storage.thumbnailPath)).toBe(true);

    const ready = await analyzeSpeakerSpotlightTemplate(pending.id, null);
    expect(ready).toMatchObject({ status: "ready", selected: true, model: "demo-template-analyzer-v1" });
    expect(ready.blueprint?.contentFields).toContain("speaker_name");
    expect(ready.blueprint).not.toHaveProperty("protectedRegions");

    const resolved = await readySpeakerSpotlightTemplate(pending.id);
    expect(speakerSpotlightTemplateSnapshot(resolved)).toMatchObject({ templateId: pending.id, name: "Editorial Neon", version: 1, width: 1024, height: 1536 });

    await deleteSpeakerSpotlightTemplate(pending.id);
    expect(listSpeakerSpotlightTemplates().some((template) => template.id === pending.id)).toBe(false);
    expect(fs.existsSync(storage.storagePath)).toBe(false);
  });

  it("increments same-name versions and falls back to another ready template when the selection is deleted", async () => {
    const first = await createPendingSpeakerSpotlightTemplate({ ...guidance, name: "Series A", fileName: "first.png", bytes: await reference(1200, 1200) });
    await analyzeSpeakerSpotlightTemplate(first.id, null);
    const second = await createPendingSpeakerSpotlightTemplate({ ...guidance, name: "series a", fileName: "second.png", bytes: await reference(1400, 900, "#092b47") });
    const secondReady = await analyzeSpeakerSpotlightTemplate(second.id, null);
    expect(secondReady).toMatchObject({ version: 2, width: 1536, height: 1024, selected: false });

    await selectTemplate(second.id);
    expect(listSpeakerSpotlightTemplates().find((template) => template.id === second.id)?.selected).toBe(true);
    await deleteSpeakerSpotlightTemplate(second.id);
    const remaining = listSpeakerSpotlightTemplates();
    expect(remaining.some((template) => template.id === first.id)).toBe(true);
    expect(remaining.filter((template) => template.selected && template.status === "ready")).toHaveLength(1);
  });

  it("does not resurrect a deliberately deleted last template and blocks generation until another is ready", async () => {
    const seeded = await ensureDefaultSpeakerSpotlightTemplate();
    expect(seeded).toHaveLength(1);
    await deleteSpeakerSpotlightTemplate(seeded[0].id);
    expect(await ensureDefaultSpeakerSpotlightTemplate()).toEqual([]);
    await expect(readySpeakerSpotlightTemplate()).rejects.toThrow(/Choose a ready Speaker Spotlight template/);
  });
});
