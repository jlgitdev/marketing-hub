import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import agendaJson from "@/data/summit-agenda.json";
import type { SpeakerSpotlightTemplate, SummitAgendaData, WorkspaceSummary } from "@/lib/types";
import { baseDataDirectory } from "@/server/data-root";
import { closeDatabase, getDatabase } from "@/server/db/database";
import {
  createSpeakerSpotlightTemplate,
  listSpeakerSpotlightTemplates,
  saveSummitAgendaData,
  setWorkspaceSetting,
  speakerSpotlightTemplateStorage
} from "@/server/db/repository";
import { DEFAULT_TEMPLATE_SEED_KEY, ensureDefaultSpeakerSpotlightTemplate } from "@/server/services/speaker-spotlight-template-service";
import { hasActiveAssistantJobs } from "@/server/services/assistant-runtime";
import {
  createWorkspaceRecord,
  deleteWorkspaceRecord,
  dismissWorkspaceOnboarding,
  getWorkspaceRecord,
  removeUninitializedWorkspaceRecord,
  runInWorkspace,
  switchWorkspace,
  workspaceDataDirectory,
  type CreateWorkspaceInput
} from "./registry";

const WORKSPACE_ASSET_DIRECTORIES = [
  "uploads",
  "generated",
  "exports",
  "tmp",
  "speaker_spotlights",
  "speaker_spotlight_templates",
  "summit_agenda"
] as const;

interface CapturedTemplate {
  template: SpeakerSpotlightTemplate;
  reference: Buffer;
  thumbnail: Buffer;
}

async function captureSelectedTemplate(): Promise<CapturedTemplate | null> {
  await ensureDefaultSpeakerSpotlightTemplate();
  const template = listSpeakerSpotlightTemplates().find((item) => item.selected && item.status === "ready") || null;
  if (!template) return null;
  const storage = speakerSpotlightTemplateStorage(template.id);
  if (!storage || !fs.existsSync(storage.storagePath) || !fs.existsSync(storage.thumbnailPath)) return null;
  return {
    template,
    reference: fs.readFileSync(storage.storagePath),
    thumbnail: fs.readFileSync(storage.thumbnailPath)
  };
}

function emptyAgenda(workspace: WorkspaceSummary): SummitAgendaData {
  const source = structuredClone(agendaJson) as unknown as SummitAgendaData;
  const start = workspace.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(workspace.eventDate)
    ? new Date(`${workspace.eventDate}T12:00:00Z`)
    : null;
  return {
    ...source,
    event: {
      ...source.event,
      name: workspace.name,
      location: workspace.location || ""
    },
    days: source.days.map((day, index) => ({
      ...day,
      date: start ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(start.getTime() + index * 86_400_000)) : "Date not set",
      sourceFile: "",
      sourceSha256: "",
      sessions: []
    }))
  };
}

function cloneExampleTemplate(captured: CapturedTemplate) {
  const id = crypto.randomUUID();
  const directory = path.join(workspaceDataDirectory(), "speaker_spotlight_templates", id);
  fs.mkdirSync(directory, { recursive: true });
  const storagePath = path.join(directory, "example-reference.png");
  const thumbnailPath = path.join(directory, "thumbnail.webp");
  fs.writeFileSync(storagePath, captured.reference, { flag: "wx" });
  fs.writeFileSync(thumbnailPath, captured.thumbnail, { flag: "wx" });
  const now = new Date().toISOString();
  createSpeakerSpotlightTemplate({
    ...captured.template,
    id,
    selected: true,
    sourceType: "builtin",
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    storagePath,
    thumbnailPath
  });
  setWorkspaceSetting(DEFAULT_TEMPLATE_SEED_KEY, id);
}

export async function createWorkspace(input: CreateWorkspaceInput) {
  const capturedTemplate = await captureSelectedTemplate();
  const workspace = createWorkspaceRecord(input);
  const directory = workspaceDataDirectory(workspace.id);
  try {
    await runInWorkspace(workspace.id, async () => {
      getDatabase();
      setWorkspaceSetting("workspace_data_profile", "empty_v1");
      saveSummitAgendaData(emptyAgenda(workspace));
      if (capturedTemplate) cloneExampleTemplate(capturedTemplate);
      else await ensureDefaultSpeakerSpotlightTemplate();
    });
    switchWorkspace(workspace.id);
    return workspace;
  } catch (error) {
    closeDatabase(workspace.id);
    removeUninitializedWorkspaceRecord(workspace.id);
    if (isWorkspaceSubdirectory(directory)) fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function selectWorkspace(workspaceId: string) {
  getDatabaseForWorkspaceWithoutInterruptingCurrent(workspaceId);
  return switchWorkspace(workspaceId);
}

function getDatabaseForWorkspaceWithoutInterruptingCurrent(workspaceId: string) {
  return runInWorkspace(workspaceId, () => getDatabase());
}

export function acknowledgeWorkspaceGuide(workspaceId: string) {
  return dismissWorkspaceOnboarding(workspaceId);
}

export function deleteWorkspace(workspaceId: string, confirmationName: string) {
  const workspace = getWorkspaceRecord(workspaceId);
  if (confirmationName.trim() !== workspace.name) throw new Error(`Type “${workspace.name}” to confirm deletion.`);
  const directory = workspaceDataDirectory(workspaceId);
  const hasActiveOperations = runInWorkspace(workspaceId, () => {
    const row = getDatabase().prepare("SELECT COUNT(*) AS count FROM ai_operations WHERE status IN ('queued','running','cancel_requested')").get() as { count?: number } | undefined;
    return Number(row?.count || 0) > 0;
  });
  if (hasActiveOperations) throw new Error("Cancel or finish this workspace’s active work before deleting it.");
  if (hasActiveAssistantJobs(workspaceId)) throw new Error("Finish the active Summit Assistant response before deleting this workspace.");

  closeDatabase(workspaceId);
  const result = deleteWorkspaceRecord(workspaceId);
  if (workspace.storage === "workspace") {
    if (!isWorkspaceSubdirectory(directory)) throw new Error("The workspace data path is outside the managed workspace directory.");
    fs.rmSync(directory, { recursive: true, force: true });
  } else {
    for (const name of WORKSPACE_ASSET_DIRECTORIES) fs.rmSync(path.join(directory, name), { recursive: true, force: true });
    for (const name of ["marketing-hub.sqlite", "marketing-hub.sqlite-wal", "marketing-hub.sqlite-shm", "marketing-hub.sqlite-journal"]) {
      fs.rmSync(path.join(directory, name), { force: true });
    }
  }
  return result;
}

function isWorkspaceSubdirectory(candidate: string) {
  const workspacesRoot = path.join(baseDataDirectory(), "workspaces");
  const relative = path.relative(workspacesRoot, path.resolve(candidate));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
