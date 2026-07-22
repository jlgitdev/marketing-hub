import { NextResponse } from "next/server";
import { z } from "zod";
import { clearAssistantMessages, createAssistantMessage, listAssistantMessages } from "@/server/db/repository";
import { currentApiKey, errorResponse, requireSafeOrigin } from "@/server/security/request";
import {
  AssistantInputSchema,
  discardAssistantAttachments,
  failedAssistantMessage,
  runAssistantRequest,
  safeError,
  validateAssistantAttachments,
  type AssistantStreamEvent
} from "@/server/services/assistant-service";
import { runInWorkspace } from "@/server/workspaces/registry";
import { hasActiveAssistantJobs, registerAssistantJob } from "@/server/services/assistant-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const AssistantRequestSchema = z.object({
  workspaceId: z.string().min(1).max(80),
  input: AssistantInputSchema
}).strict();
const WorkspaceIdSchema = z.string().min(1).max(80);

export async function GET(request: Request) {
  try {
    const workspaceId = WorkspaceIdSchema.parse(new URL(request.url).searchParams.get("workspaceId"));
    const messages = runInWorkspace(workspaceId, () => listAssistantMessages(120));
    return NextResponse.json({ messages }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  let requestWorkspaceId: string | null = null;
  let requestAttachmentIds: string[] = [];
  try {
    await requireSafeOrigin(request);
    const mediaType = (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (mediaType !== "application/json") throw new Error("Assistant requests must use application/json.");
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 1_000_000) throw new Error("Assistant requests must be 1 MB or smaller after attachments are uploaded.");
    const { workspaceId, input } = AssistantRequestSchema.parse(await request.json());
    requestWorkspaceId = workspaceId;
    requestAttachmentIds = input.attachmentIds;
    runInWorkspace(workspaceId, () => validateAssistantAttachments(input));
    const abortController = new AbortController();
    const unregisterJob = registerAssistantJob(workspaceId, abortController);
    const abort = () => abortController.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abortController.abort();
    let apiKey: string | null;
    let userMessage: ReturnType<typeof createAssistantMessage>;
    try {
      if (abortController.signal.aborted) throw new DOMException("The assistant request was canceled.", "AbortError");
      apiKey = await currentApiKey();
      if (abortController.signal.aborted) throw new DOMException("The assistant request was canceled.", "AbortError");
      const userContent = input.prompt.trim() || (input.attachedText.trim() ? "Add the attached text to Context." : `Add ${input.attachmentIds.length} attached image${input.attachmentIds.length === 1 ? "" : "s"} to Context.`);
      userMessage = runInWorkspace(workspaceId, () => createAssistantMessage({
        role: "user",
        mode: input.mode,
        content: userContent,
        status: "completed",
        attachmentIds: Array.from(new Set(input.attachmentIds)),
        textAttachments: input.textAttachments,
        contextDocumentIds: [],
        generatedAssetId: null,
        contentCampaignId: null,
        savedContextDocumentId: null,
        warnings: []
      }));
    } catch (error) {
      unregisterJob();
      request.signal.removeEventListener("abort", abort);
      throw error;
    }

    const encoder = new TextEncoder();
    let closed = false;
    let sequence = 0;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = (event: AssistantStreamEvent) => {
          if (closed) return;
          try {
            sequence += 1;
            controller.enqueue(encoder.encode(`${JSON.stringify({ ...event, sequence })}\n`));
          } catch {
            closed = true;
            abortController.abort();
          }
        };
        emit({ type: "accepted", message: userMessage });
        void runInWorkspace(workspaceId, async () => {
          try {
            const message = await runAssistantRequest(input, apiKey, emit, abortController.signal);
            emit({ type: "complete", message });
          } catch (error) {
            if (!abortController.signal.aborted) {
              const message = failedAssistantMessage(input.mode, error);
              emit({ type: "error", error: safeError(error), message });
            }
          } finally {
            unregisterJob();
            request.signal.removeEventListener("abort", abort);
            if (!closed) {
              closed = true;
              try { controller.close(); } catch { /* The browser already closed the stream. */ }
            }
          }
        });
      },
      cancel() {
        closed = true;
        abortController.abort();
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no"
      }
    });
  } catch (error) {
    if (requestWorkspaceId && requestAttachmentIds.length) {
      try { runInWorkspace(requestWorkspaceId, () => discardAssistantAttachments(requestAttachmentIds)); } catch { /* Preserve the original request error. */ }
    }
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireSafeOrigin(request);
    const workspaceId = WorkspaceIdSchema.parse(new URL(request.url).searchParams.get("workspaceId"));
    if (hasActiveAssistantJobs(workspaceId)) throw new Error("Wait for the active Summit Assistant response before clearing this conversation.");
    runInWorkspace(workspaceId, () => clearAssistantMessages());
    return NextResponse.json({ cleared: true });
  } catch (error) {
    return errorResponse(error);
  }
}
