import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  currentApiKey: vi.fn(),
  requireSafeOrigin: vi.fn(),
  runAssistantRequest: vi.fn()
}));

vi.mock("@/server/security/request", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/security/request")>();
  return {
    ...actual,
    currentApiKey: routeMocks.currentApiKey,
    requireSafeOrigin: routeMocks.requireSafeOrigin
  };
});

vi.mock("@/server/services/assistant-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/assistant-service")>();
  return { ...actual, runAssistantRequest: routeMocks.runAssistantRequest };
});

import { DELETE, GET, POST } from "@/app/api/assistant/route";
import type { AssistantMessage } from "@/lib/types";
import { closeAllDatabases } from "@/server/db/database";
import { createAssistantMessage, listAssistantMessages, resetAllData } from "@/server/db/repository";
import { hasActiveAssistantJobs } from "@/server/services/assistant-runtime";
import type { AssistantInput } from "@/server/services/assistant-service";
import {
  createWorkspaceRecord,
  currentWorkspaceId,
  runInWorkspace
} from "@/server/workspaces/registry";
import { deleteWorkspace } from "@/server/workspaces/service";

const originalDataDirectory = process.env.MARKETING_HUB_DATA_DIR;
const testDataDirectory = path.join(os.tmpdir(), `marketing-hub-assistant-route-vitest-${process.pid}`);

let settlePendingWorkflow: (() => void) | null = null;

beforeAll(() => {
  process.env.MARKETING_HUB_DATA_DIR = testDataDirectory;
});

beforeEach(() => {
  settlePendingWorkflow?.();
  settlePendingWorkflow = null;
  routeMocks.currentApiKey.mockReset().mockResolvedValue(null);
  routeMocks.requireSafeOrigin.mockReset().mockResolvedValue(undefined);
  routeMocks.runAssistantRequest.mockReset();
  closeAllDatabases();
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
  resetAllData();
});

afterAll(() => {
  settlePendingWorkflow?.();
  closeAllDatabases();
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
  if (originalDataDirectory === undefined) delete process.env.MARKETING_HUB_DATA_DIR;
  else process.env.MARKETING_HUB_DATA_DIR = originalDataDirectory;
});

function assistantReply(input: AssistantInput): AssistantMessage {
  return createAssistantMessage({
    role: "assistant",
    mode: input.mode,
    content: "A workspace-scoped test response.",
    status: "completed",
    attachmentIds: [],
    contextDocumentIds: [],
    generatedAssetId: null,
    contentCampaignId: null,
    savedContextDocumentId: null,
    warnings: []
  });
}

function savedAssistantMessage(content: string): AssistantMessage {
  return createAssistantMessage({
    role: "assistant",
    mode: "ask",
    content,
    status: "completed",
    attachmentIds: [],
    contextDocumentIds: [],
    generatedAssetId: null,
    contentCampaignId: null,
    savedContextDocumentId: null,
    warnings: []
  });
}

function assistantRequest(workspaceId: string, prompt: string) {
  return new Request("http://127.0.0.1:3000/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      input: { mode: "ask", prompt, attachedText: "", attachmentIds: [] }
    })
  });
}

describe("Summit Assistant POST route lifecycle", () => {
  it("rejects non-JSON request media types before creating side effects", async () => {
    const response = await POST(new Request("http://127.0.0.1:3000/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ workspaceId: "default", input: { mode: "ask", prompt: "Do not run." } })
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/application\/json/i) });
    expect(routeMocks.runAssistantRequest).not.toHaveBeenCalled();
    expect(listAssistantMessages()).toEqual([]);
  });

  it("binds persisted messages to the requested workspace instead of the ambient workspace", async () => {
    const requestedWorkspace = createWorkspaceRecord({ name: "Requested Assistant Workspace" });
    expect(currentWorkspaceId()).toBe("default");
    routeMocks.runAssistantRequest.mockImplementation(async (input: AssistantInput) => assistantReply(input));

    const response = await POST(assistantRequest(requestedWorkspace.id, "What is this summit about?"));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string });

    expect(response.status).toBe(200);
    expect(events.map((event) => event.type)).toEqual(["accepted", "complete"]);
    expect(currentWorkspaceId()).toBe("default");
    expect(listAssistantMessages()).toEqual([]);
    expect(runInWorkspace(requestedWorkspace.id, () => listAssistantMessages())).toEqual([
      expect.objectContaining({ role: "user", content: "What is this summit about?" }),
      expect.objectContaining({ role: "assistant", content: "A workspace-scoped test response." })
    ]);
  });

  it("persists text attachment provenance in the user transcript message", async () => {
    routeMocks.runAssistantRequest.mockImplementation(async (input: AssistantInput) => assistantReply(input));
    const textAttachments = [{ name: "speaker-notes.md", content: "# Speaker notes\n\nUse the approved biography." }];
    const attachedText = `## Attached file: ${textAttachments[0].name}\n\n${textAttachments[0].content}`;

    const response = await POST(new Request("http://127.0.0.1:3000/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "default",
        input: { mode: "context", prompt: "Save these notes.", attachedText, textAttachments, attachmentIds: [] }
      })
    }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string; message?: AssistantMessage });

    expect(response.status).toBe(200);
    expect(events[0]).toMatchObject({ type: "accepted", message: { role: "user", textAttachments } });
    expect(listAssistantMessages()[0]).toMatchObject({ role: "user", textAttachments });
  });

  it("keeps cancellation registered until the async workflow settles", async () => {
    const workspace = createWorkspaceRecord({ name: "Canceling Assistant Workspace" });
    let workflowSignal: AbortSignal | undefined;
    routeMocks.runAssistantRequest.mockImplementation((input: AssistantInput, _apiKey: string | null, _emit: unknown, signal?: AbortSignal) => {
      workflowSignal = signal;
      const reply = assistantReply(input);
      return new Promise<AssistantMessage>((resolve) => {
        settlePendingWorkflow = () => resolve(reply);
      });
    });

    const response = await POST(assistantRequest(workspace.id, "Keep this job open while canceling."));
    const reader = response.body!.getReader();
    const firstChunk = await reader.read();

    expect(new TextDecoder().decode(firstChunk.value)).toContain('"type":"accepted"');
    expect(hasActiveAssistantJobs(workspace.id)).toBe(true);

    await reader.cancel();

    expect(workflowSignal?.aborted).toBe(true);
    expect(hasActiveAssistantJobs(workspace.id)).toBe(true);
    expect(() => deleteWorkspace(workspace.id, workspace.name)).toThrow(/active Summit Assistant response/i);

    settlePendingWorkflow!();
    settlePendingWorkflow = null;
    await vi.waitFor(() => expect(hasActiveAssistantJobs(workspace.id)).toBe(false));

    expect(deleteWorkspace(workspace.id, workspace.name).deleted.id).toBe(workspace.id);
  });
});

describe("Summit Assistant transcript route workspace binding", () => {
  it("GET returns only messages from the requested non-active workspace", async () => {
    const workspace = createWorkspaceRecord({ name: "Transcript Read Workspace" });
    const defaultMessage = savedAssistantMessage("Default workspace transcript.");
    const requestedMessage = runInWorkspace(workspace.id, () => savedAssistantMessage("Requested workspace transcript."));

    const response = await GET(new Request(`http://127.0.0.1:3000/api/assistant?workspaceId=${workspace.id}`));
    const payload = await response.json() as { messages: AssistantMessage[] };

    expect(response.status).toBe(200);
    expect(currentWorkspaceId()).toBe("default");
    expect(payload.messages).toEqual([
      expect.objectContaining({ id: requestedMessage.id, content: "Requested workspace transcript." })
    ]);
    expect(payload.messages.map((message) => message.id)).not.toContain(defaultMessage.id);
  });

  it("DELETE clears only the requested non-active workspace", async () => {
    const workspace = createWorkspaceRecord({ name: "Transcript Clear Workspace" });
    const defaultMessage = savedAssistantMessage("Keep the active workspace transcript.");
    runInWorkspace(workspace.id, () => savedAssistantMessage("Clear the requested workspace transcript."));

    const response = await DELETE(new Request(`http://127.0.0.1:3000/api/assistant?workspaceId=${workspace.id}`, {
      method: "DELETE"
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ cleared: true });
    expect(currentWorkspaceId()).toBe("default");
    expect(listAssistantMessages()).toEqual([expect.objectContaining({ id: defaultMessage.id })]);
    expect(runInWorkspace(workspace.id, () => listAssistantMessages())).toEqual([]);
  });
});
