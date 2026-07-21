import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ResearchRun } from "@/lib/types";
import { closeAllDatabases } from "@/server/db/database";
import {
  createContextDocument,
  createResearchRun,
  listContextDocuments,
  listResearchRuns,
  listSpeakerSpotlightTemplates,
  resetAllData
} from "@/server/db/repository";
import { ensureDefaultSpeakerSpotlightTemplate } from "@/server/services/speaker-spotlight-template-service";
import { getSummitAgendaWorkspace } from "@/server/services/summit-agenda-service";
import { DEMO_CONTEXT } from "@/server/ai/demo-provider";
import { createAiOperation } from "@/server/operations/repository";
import {
  activeWorkspaceId,
  currentWorkspaceId,
  getActiveWorkspace,
  listWorkspaces,
  runInWorkspace,
  switchWorkspace,
  workspaceDataDirectory
} from "@/server/workspaces/registry";
import { acknowledgeWorkspaceGuide, createWorkspace, deleteWorkspace } from "@/server/workspaces/service";

const originalDataDirectory = process.env.MARKETING_HUB_DATA_DIR;
const testDataDirectory = path.join(os.tmpdir(), `marketing-hub-workspaces-vitest-${process.pid}`);

beforeAll(() => { process.env.MARKETING_HUB_DATA_DIR = testDataDirectory; });
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
});

function savedRun(id: string): ResearchRun {
  const now = new Date().toISOString();
  return {
    id,
    name: "Original summit research",
    objective: "Keep this run attached to the original workspace",
    region: "San Francisco",
    status: "completed",
    requestedCount: 5,
    resultCount: 0,
    contextDocumentIds: [],
    settings: {},
    model: "test-model",
    promptVersion: "test-v1",
    provider: "demo",
    usage: null,
    warnings: [],
    error: null,
    rawOutput: null,
    startedAt: now,
    completedAt: now
  };
}

describe("multiple summit workspaces", () => {
  it("keeps existing records in the original workspace and starts a new summit clean", async () => {
    const original = getActiveWorkspace();
    createContextDocument(DEMO_CONTEXT[0]);
    createResearchRun(savedRun("original-run"));
    const originalTemplates = await ensureDefaultSpeakerSpotlightTemplate();
    const selectedTemplate = originalTemplates.find((template) => template.selected)!;

    const created = await createWorkspace({
      name: "Robotics Leadership Forum",
      eventDate: "2027-04-12",
      location: "Oakland",
      goal: "Fill the room with robotics operators and investors."
    });

    expect(activeWorkspaceId()).toBe(created.id);
    expect(listContextDocuments()).toEqual([]);
    expect(listResearchRuns()).toEqual([]);
    expect(getSummitAgendaWorkspace().agenda.days.every((day) => day.sessions.length === 0)).toBe(true);
    expect(getSummitAgendaWorkspace().batches).toEqual([]);
    expect(listSpeakerSpotlightTemplates()).toEqual([
      expect.objectContaining({ name: selectedTemplate.name, sourceType: "builtin", selected: true, status: "ready" })
    ]);

    runInWorkspace(original.id, () => {
      expect(listContextDocuments()).toHaveLength(1);
      expect(listResearchRuns()).toEqual([expect.objectContaining({ id: "original-run" })]);
      expect(listSpeakerSpotlightTemplates().some((template) => template.id === selectedTemplate.id)).toBe(true);
    });

    resetAllData();
    expect(getSummitAgendaWorkspace().agenda.days.every((day) => day.sessions.length === 0)).toBe(true);
  });

  it("switches between isolated databases without losing either workspace", async () => {
    const original = getActiveWorkspace();
    createContextDocument({ ...DEMO_CONTEXT[0], title: "Original context" });
    const second = await createWorkspace({ name: "AI Education Summit" });
    createContextDocument({ ...DEMO_CONTEXT[0], title: "Education context" });

    switchWorkspace(original.id);
    expect(listContextDocuments().map((document) => document.title)).toEqual(["Original context"]);
    switchWorkspace(second.id);
    expect(listContextDocuments().map((document) => document.title)).toEqual(["Education context"]);
    expect(workspaceDataDirectory(second.id)).toContain(path.join("workspaces", second.id));
  });

  it("requires an exact confirmation, removes only the target, and never deletes the last workspace", async () => {
    const original = getActiveWorkspace();
    const second = await createWorkspace({ name: "Climate Compute Summit" });
    const secondDirectory = workspaceDataDirectory(second.id);
    createContextDocument({ ...DEMO_CONTEXT[0], title: "Climate context" });
    switchWorkspace(original.id);

    expect(() => deleteWorkspace(second.id, "wrong name")).toThrow(/Type “Climate Compute Summit”/);
    expect(fs.existsSync(secondDirectory)).toBe(true);
    deleteWorkspace(second.id, second.name);
    expect(listWorkspaces().map((workspace) => workspace.id)).toEqual([original.id]);
    expect(fs.existsSync(secondDirectory)).toBe(false);
    expect(() => deleteWorkspace(original.id, original.name)).toThrow(/Keep at least one workspace/);
  });

  it("persists onboarding completion and rejects confusing duplicate names", async () => {
    const created = await createWorkspace({ name: "Frontier Systems Summit" });
    expect(getActiveWorkspace().onboardingDismissedAt).toBeNull();
    acknowledgeWorkspaceGuide(created.id);
    expect(getActiveWorkspace().onboardingDismissedAt).not.toBeNull();
    await expect(createWorkspace({ name: "Frontier Systems Summit" })).rejects.toThrow(/already exists/);
  });

  it("keeps asynchronous work scoped and blocks deletion while that workspace has active work", async () => {
    const original = getActiveWorkspace();
    const created = await createWorkspace({ name: "Secure AI Forum" });
    const scopedId = await runInWorkspace(created.id, async () => {
      await Promise.resolve();
      return currentWorkspaceId();
    });
    expect(scopedId).toBe(created.id);
    createAiOperation({
      kind: "research",
      label: "Secure AI research",
      steps: [],
      originPath: "/leads",
      targetKey: "research:secure-ai",
      operationInput: {}
    });
    switchWorkspace(original.id);
    expect(() => deleteWorkspace(created.id, created.name)).toThrow(/active work/);
  });
});
