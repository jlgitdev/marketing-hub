import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { WorkspaceSummary } from "@/lib/types";
import { baseDataDirectory } from "@/server/data-root";

const REGISTRY_VERSION = 1;
const DEFAULT_WORKSPACE_ID = "default";
const MAX_WORKSPACES = 24;
const workspaceScope = new AsyncLocalStorage<string>();

const WorkspaceRecordSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(2).max(80),
  eventDate: z.string().max(40).nullable(),
  location: z.string().max(120).nullable(),
  goal: z.string().max(500).nullable(),
  storage: z.enum(["root", "workspace"]),
  importProjectContext: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastOpenedAt: z.string(),
  onboardingDismissedAt: z.string().nullable()
});

const WorkspaceRegistrySchema = z.object({
  version: z.literal(REGISTRY_VERSION),
  activeWorkspaceId: z.string().min(1),
  workspaces: z.array(WorkspaceRecordSchema).min(1).max(MAX_WORKSPACES)
});

export type WorkspaceRecord = z.infer<typeof WorkspaceRecordSchema>;
type WorkspaceRegistry = z.infer<typeof WorkspaceRegistrySchema>;

export interface CreateWorkspaceInput {
  name: string;
  eventDate?: string | null;
  location?: string | null;
  goal?: string | null;
}

function registryPath() {
  return path.join(baseDataDirectory(), "workspaces.json");
}

function defaultRegistry(): WorkspaceRegistry {
  const now = new Date().toISOString();
  return {
    version: REGISTRY_VERSION,
    activeWorkspaceId: DEFAULT_WORKSPACE_ID,
    workspaces: [{
      id: DEFAULT_WORKSPACE_ID,
      name: "AGI Summit",
      eventDate: null,
      location: "San Francisco",
      goal: "Plan and run the current AGI Summit marketing program.",
      storage: "root",
      importProjectContext: true,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      onboardingDismissedAt: now
    }]
  };
}

function readRegistry(): WorkspaceRegistry {
  const filePath = registryPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    const initial = defaultRegistry();
    writeRegistry(initial);
    return initial;
  }
  try {
    const registry = WorkspaceRegistrySchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    if (!registry.workspaces.some((workspace) => workspace.id === registry.activeWorkspaceId)) {
      throw new Error("The active workspace is missing from the registry.");
    }
    return registry;
  } catch (error) {
    throw new Error("The local workspace registry could not be read. Restore or remove workspaces.json before continuing.", { cause: error });
  }
}

function writeRegistry(registry: WorkspaceRegistry) {
  const parsed = WorkspaceRegistrySchema.parse(registry);
  const filePath = registryPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function normalizedOptional(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function publicWorkspace(workspace: WorkspaceRecord): WorkspaceSummary {
  const { storage: _storage, importProjectContext: _importProjectContext, ...summary } = workspace;
  void _storage; void _importProjectContext;
  return summary;
}

export function listWorkspaceRecords() {
  return readRegistry().workspaces.slice().sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
}

export function listWorkspaces() {
  return listWorkspaceRecords().map(publicWorkspace);
}

export function activeWorkspaceId() {
  return readRegistry().activeWorkspaceId;
}

export function currentWorkspaceId() {
  return workspaceScope.getStore() || activeWorkspaceId();
}

export function getWorkspaceRecord(workspaceId = currentWorkspaceId()) {
  const workspace = readRegistry().workspaces.find((item) => item.id === workspaceId);
  if (!workspace) throw new Error("Workspace not found.");
  return workspace;
}

export function getActiveWorkspace() {
  return publicWorkspace(getWorkspaceRecord(activeWorkspaceId()));
}

export function workspaceDataDirectory(workspaceId = currentWorkspaceId()) {
  const workspace = getWorkspaceRecord(workspaceId);
  return workspace.storage === "root"
    ? baseDataDirectory()
    : path.join(baseDataDirectory(), "workspaces", workspace.id);
}

export function shouldImportProjectContext() {
  return getWorkspaceRecord().importProjectContext;
}

export function runInWorkspace<T>(workspaceId: string, work: () => T): T {
  getWorkspaceRecord(workspaceId);
  return workspaceScope.run(workspaceId, work);
}

export function createWorkspaceRecord(input: CreateWorkspaceInput) {
  const registry = readRegistry();
  if (registry.workspaces.length >= MAX_WORKSPACES) throw new Error(`Marketing Hub supports up to ${MAX_WORKSPACES} workspaces on this device.`);
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) throw new Error("Workspace names must be between 2 and 80 characters.");
  if (registry.workspaces.some((workspace) => workspace.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)) {
    throw new Error(`A workspace named “${name}” already exists.`);
  }
  const now = new Date().toISOString();
  const workspace: WorkspaceRecord = {
    id: crypto.randomUUID(),
    name,
    eventDate: normalizedOptional(input.eventDate),
    location: normalizedOptional(input.location),
    goal: normalizedOptional(input.goal),
    storage: "workspace",
    importProjectContext: false,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    onboardingDismissedAt: null
  };
  writeRegistry({ ...registry, workspaces: [...registry.workspaces, workspace] });
  return publicWorkspace(workspace);
}

export function removeUninitializedWorkspaceRecord(workspaceId: string) {
  const registry = readRegistry();
  const workspace = registry.workspaces.find((item) => item.id === workspaceId);
  if (!workspace || workspace.storage !== "workspace" || registry.activeWorkspaceId === workspaceId) return;
  writeRegistry({ ...registry, workspaces: registry.workspaces.filter((item) => item.id !== workspaceId) });
}

export function switchWorkspace(workspaceId: string) {
  const registry = readRegistry();
  const target = registry.workspaces.find((workspace) => workspace.id === workspaceId);
  if (!target) throw new Error("Workspace not found.");
  const now = new Date().toISOString();
  const workspaces = registry.workspaces.map((workspace) => workspace.id === workspaceId
    ? { ...workspace, lastOpenedAt: now, updatedAt: now }
    : workspace);
  writeRegistry({ ...registry, activeWorkspaceId: workspaceId, workspaces });
  return publicWorkspace(workspaces.find((workspace) => workspace.id === workspaceId)!);
}

export function dismissWorkspaceOnboarding(workspaceId: string) {
  const registry = readRegistry();
  if (!registry.workspaces.some((workspace) => workspace.id === workspaceId)) throw new Error("Workspace not found.");
  const now = new Date().toISOString();
  const workspaces = registry.workspaces.map((workspace) => workspace.id === workspaceId
    ? { ...workspace, onboardingDismissedAt: now, updatedAt: now }
    : workspace);
  writeRegistry({ ...registry, workspaces });
  return publicWorkspace(workspaces.find((workspace) => workspace.id === workspaceId)!);
}

export function deleteWorkspaceRecord(workspaceId: string) {
  const registry = readRegistry();
  const target = registry.workspaces.find((workspace) => workspace.id === workspaceId);
  if (!target) throw new Error("Workspace not found.");
  if (registry.workspaces.length === 1) throw new Error("Keep at least one workspace on this device.");
  const remaining = registry.workspaces.filter((workspace) => workspace.id !== workspaceId);
  const activeWorkspaceId = registry.activeWorkspaceId === workspaceId
    ? remaining.slice().sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))[0].id
    : registry.activeWorkspaceId;
  writeRegistry({ ...registry, activeWorkspaceId, workspaces: remaining });
  return { deleted: publicWorkspace(target), activeWorkspace: publicWorkspace(remaining.find((workspace) => workspace.id === activeWorkspaceId)!) };
}
