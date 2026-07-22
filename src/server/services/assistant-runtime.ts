import crypto from "node:crypto";

interface AssistantJob {
  id: string;
  controller: AbortController;
}

const assistantGlobal = globalThis as typeof globalThis & {
  __marketingHubAssistantJobs?: Map<string, Map<string, AssistantJob>>;
};

const jobsByWorkspace = assistantGlobal.__marketingHubAssistantJobs ?? new Map<string, Map<string, AssistantJob>>();
assistantGlobal.__marketingHubAssistantJobs = jobsByWorkspace;

export function registerAssistantJob(workspaceId: string, controller: AbortController) {
  const job: AssistantJob = { id: crypto.randomUUID(), controller };
  const workspaceJobs = jobsByWorkspace.get(workspaceId) ?? new Map<string, AssistantJob>();
  workspaceJobs.set(job.id, job);
  jobsByWorkspace.set(workspaceId, workspaceJobs);
  return () => {
    workspaceJobs.delete(job.id);
    if (!workspaceJobs.size) jobsByWorkspace.delete(workspaceId);
  };
}

export function hasActiveAssistantJobs(workspaceId: string) {
  return Boolean(jobsByWorkspace.get(workspaceId)?.size);
}
