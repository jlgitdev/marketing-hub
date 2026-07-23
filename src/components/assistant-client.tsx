"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpenText,
  Check,
  Clipboard,
  Download,
  FileText,
  Image as ImageIcon,
  Paperclip,
  PenLine,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { OrbState } from "@/vendor/thinking-orbs";
import { AiThinkingOrb } from "./ai-thinking-orb";
import { apiRequest, cleanDocumentTitle, ConnectionBadge, PageState, useWorkspace } from "./workspace";

type AssistantMode = "ask" | "create" | "context";
type AssistantMessageStatus = "completed" | "partial" | "failed";
type WorkflowState = "pending" | "active" | "completed" | "failed";

interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  mode: AssistantMode;
  content: string;
  status: AssistantMessageStatus;
  attachmentIds: string[];
  textAttachments: Array<{ name: string; content: string }>;
  contextDocumentIds: string[];
  generatedAssetId: string | null;
  generatedAssetWidth: number | null;
  generatedAssetHeight: number | null;
  contentCampaignId: string | null;
  savedContextDocumentId: string | null;
  warnings: string[];
  createdAt: string;
}

interface SavedContextDocument {
  id: string;
  title: string;
  type: string;
  summary: string;
  tags: string[];
}

type AssistantStreamEvent =
  | { type: "accepted"; message: AssistantMessage }
  | { type: "stage"; id: string; label: string; state: WorkflowState; detail?: string }
  | { type: "delta"; delta: string }
  | { type: "asset"; assetId: string; width: number; height: number }
  | { type: "context_saved"; document: SavedContextDocument }
  | { type: "complete"; message: AssistantMessage }
  | { type: "error"; error: string; message?: AssistantMessage };

interface WorkflowStage {
  id: string;
  label: string;
  state: WorkflowState;
  detail?: string;
}

interface DraftAttachment {
  id: string;
  kind: "image" | "text";
  file: File;
  previewUrl: string | null;
  text: string;
  assetId: string | null;
}

interface ModeOption {
  value: AssistantMode;
  label: string;
  description: string;
  example: string;
  icon: LucideIcon;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    value: "ask",
    label: "Ask summit",
    description: "Get a grounded answer from the active summit context.",
    example: "Ask about speakers, dates, venue, agenda, or registration",
    icon: Search
  },
  {
    value: "create",
    label: "Create content",
    description: "Make one ready-to-use post and matching graphic.",
    example: "Describe the post and optionally attach one reference image",
    icon: PenLine
  },
  {
    value: "context",
    label: "Add context",
    description: "Turn notes, documents, or images into reusable context.",
    example: "Paste material or attach up to four source files",
    icon: BookOpenText
  }
];

const PLACEHOLDERS: Record<AssistantMode, string> = {
  ask: "Ask about the summit…",
  create: "Describe the post and graphic you want…",
  context: "Paste or describe the context to add…"
};

const MAX_IMAGE_BYTES = 8_000_000;
const MAX_TEXT_BYTES = 1_000_000;
const MAX_ATTACHED_TEXT = 120_000;

export function AssistantClient() {
  const workspace = useWorkspace();
  return <AssistantWorkspaceClient key={workspace.state?.activeWorkspace.id || "workspace-loading"}/>;
}

function AssistantWorkspaceClient() {
  const workspace = useWorkspace();
  const workspaceId = workspace.state?.activeWorkspace.id || null;
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(true);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [mode, setMode] = useState<AssistantMode>("ask");
  const [prompt, setPrompt] = useState("");
  const [sourceOfTruth, setSourceOfTruth] = useState(false);
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [stages, setStages] = useState<WorkflowStage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [streamingAsset, setStreamingAsset] = useState<{ id: string; width: number; height: number } | null>(null);
  const [streamingContext, setStreamingContext] = useState<SavedContextDocument | null>(null);
  const [contextDetails, setContextDetails] = useState<Record<string, SavedContextDocument>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const clearCancelRef = useRef<HTMLButtonElement>(null);
  const clearTriggerRef = useRef<HTMLButtonElement>(null);
  const clearPanelRef = useRef<HTMLElement>(null);
  const clearWasOpenRef = useRef(false);
  const attachmentsRef = useRef<DraftAttachment[]>([]);
  const nearBottomRef = useRef(true);
  const activeRequestRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const transcriptLoadRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const streamRenderFrameRef = useRef<number | null>(null);
  const pendingStreamingTextRef = useRef("");

  const loadTranscript = useCallback(async () => {
    if (!workspaceId) return;
    const loadId = ++transcriptLoadRef.current;
    setTranscriptLoading(true);
    setTranscriptError(null);
    try {
      const body = await apiRequest<{ messages: AssistantMessage[] }>(`/api/assistant?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
      if (loadId !== transcriptLoadRef.current) return;
      setMessages(Array.isArray(body.messages) ? body.messages : []);
      nearBottomRef.current = true;
    } catch (caught) {
      if (loadId !== transcriptLoadRef.current) return;
      setTranscriptError(caught instanceof Error ? caught.message : "The saved conversation could not be opened.");
    } finally {
      if (loadId === transcriptLoadRef.current) setTranscriptLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadTranscript(), 0);
    return () => window.clearTimeout(timer);
  }, [loadTranscript]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => () => {
    const controller = activeRequestRef.current;
    activeRequestRef.current = null;
    sendingRef.current = false;
    controller?.abort();
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    if (streamRenderFrameRef.current !== null) window.cancelAnimationFrame(streamRenderFrameRef.current);
    releaseAttachments(attachmentsRef.current);
  }, []);

  useEffect(() => {
    if (confirmClear) {
      clearWasOpenRef.current = true;
      clearCancelRef.current?.focus();
    } else if (clearWasOpenRef.current) {
      clearWasOpenRef.current = false;
      clearTriggerRef.current?.focus();
    }
  }, [confirmClear]);

  const queueStreamingText = useCallback((content: string) => {
    pendingStreamingTextRef.current = content;
    if (streamRenderFrameRef.current !== null) return;
    streamRenderFrameRef.current = window.requestAnimationFrame(() => {
      streamRenderFrameRef.current = null;
      setStreamingText(pendingStreamingTextRef.current);
    });
  }, []);

  const resetStreamingText = useCallback(() => {
    pendingStreamingTextRef.current = "";
    if (streamRenderFrameRef.current !== null) {
      window.cancelAnimationFrame(streamRenderFrameRef.current);
      streamRenderFrameRef.current = null;
    }
    setStreamingText("");
  }, []);

  const scrollToLatest = useCallback((force = false, smooth = false) => {
    if (!force && !nearBottomRef.current) return;
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const transcript = transcriptRef.current;
      const behavior = smooth && !reduceMotion ? "smooth" : "auto";
      if (transcript && window.getComputedStyle(transcript).overflowY !== "visible" && transcript.scrollHeight > transcript.clientHeight) {
        transcript.scrollTo({ top: transcript.scrollHeight, behavior });
      } else if (force) {
        threadEndRef.current?.scrollIntoView({ behavior, block: "nearest" });
      }
    });
  }, []);

  useEffect(() => {
    scrollToLatest();
  }, [messages.length, sending, streamingText, streamingAsset, scrollToLatest]);

  function selectMode(nextMode: AssistantMode) {
    if (sending) return;
    if (nextMode === mode) {
      textareaRef.current?.focus();
      return;
    }
    setAttachments((current) => {
      const kept = nextMode === "context"
        ? current.slice(0, 4)
        : nextMode === "create"
          ? current.filter((item) => item.kind === "image").slice(0, 1)
          : [];
      const keptIds = new Set(kept.map((item) => item.id));
      releaseAttachments(current.filter((item) => !keptIds.has(item.id)));
      return kept;
    });
    setMode(nextMode);
    if (nextMode !== "context") setSourceOfTruth(false);
    setComposerError(null);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  async function addFiles(files: File[]) {
    if (sendingRef.current) return;
    if (!files.length) return;
    if (mode === "ask") {
      setComposerError("Attachments are available in Create content and Add context modes.");
      return;
    }
    const limit = mode === "create" ? 1 : 4;
    const available = Math.max(0, limit - attachments.length);
    if (!available) {
      setComposerError(mode === "create" ? "Create content accepts one reference image." : "Add context accepts up to four attachments at a time.");
      return;
    }

    const next: DraftAttachment[] = [];
    let attachedTextLength = attachments.reduce((total, item) => total + item.text.length, 0);
    let issue: string | null = null;
    for (const file of files.slice(0, available)) {
      const isImage = ["image/png", "image/jpeg", "image/webp"].includes(file.type);
      const isText = /\.(md|txt)$/i.test(file.name) || ["text/plain", "text/markdown"].includes(file.type);
      if (mode === "create" && !isImage) {
        issue = "Create content accepts a PNG, JPEG, or WebP reference image.";
        continue;
      }
      if (!isImage && !isText) {
        issue = "Use PNG, JPEG, WebP, Markdown, or text files.";
        continue;
      }
      if (isImage && file.size > MAX_IMAGE_BYTES) {
        issue = `${file.name} is larger than the 8 MB image limit.`;
        continue;
      }
      if (isText && file.size > MAX_TEXT_BYTES) {
        issue = `${file.name} is larger than the 1 MB text-file limit.`;
        continue;
      }
      const text = isText ? await file.text() : "";
      if (attachedTextLength + text.length > MAX_ATTACHED_TEXT) {
        issue = "Attached text is longer than the 120,000-character context limit.";
        continue;
      }
      attachedTextLength += text.length;
      next.push({
        id: crypto.randomUUID(),
        kind: isImage ? "image" : "text",
        file,
        previewUrl: isImage ? URL.createObjectURL(file) : null,
        text,
        assetId: null
      });
    }
    if (next.length) setAttachments((current) => [...current, ...next].slice(0, limit));
    setComposerError(issue || (files.length > available ? `Only ${limit} attachment${limit === 1 ? " is" : "s are"} allowed in this mode.` : null));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(id: string) {
    if (sendingRef.current) return;
    setAttachments((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) releaseAttachments([removed]);
      return current.filter((item) => item.id !== id);
    });
    setComposerError(null);
  }

  async function prepareAttachments(items: DraftAttachment[], targetWorkspaceId: string, signal: AbortSignal) {
    const prepared = [...items];
    try {
      for (let index = 0; index < prepared.length; index += 1) {
        const item = prepared[index];
        if (item.kind !== "image" || item.assetId) continue;
        setLiveStatus(`Uploading ${item.file.name}`);
        const form = new FormData();
        form.set("workspaceId", targetWorkspaceId);
        form.set("file", item.file);
        form.set("title", `Assistant source — ${item.file.name}`.slice(0, 160));
        form.set("type", "assistant_attachment");
        const asset = await apiRequest<{ id: string }>("/api/assets", { method: "POST", body: form, signal });
        prepared[index] = { ...item, assetId: asset.id };
        setAttachments([...prepared]);
      }
      return prepared;
    } catch (error) {
      await cleanupTemporaryAttachments(prepared, targetWorkspaceId);
      setAttachments(items.map((item) => ({ ...item, assetId: null })));
      throw error;
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendingRef.current) return;
    if (!workspaceId) {
      setComposerError("Wait for the active workspace to finish loading.");
      return;
    }
    if (transcriptLoading) {
      setComposerError("Wait for the saved conversation to finish loading.");
      return;
    }
    const cleanedPrompt = prompt.trim();
    const effectivePrompt = cleanedPrompt || (mode === "context" && attachments.length ? "Add the attached material to the summit context." : "");
    if (!effectivePrompt) {
      setComposerError(mode === "context" ? "Add text or attach source material." : "Enter a request first.");
      textareaRef.current?.focus();
      return;
    }
    if (mode === "create" && !cleanedPrompt) {
      setComposerError("Describe the post you want to create.");
      textareaRef.current?.focus();
      return;
    }
    const promptLimit = mode === "ask" ? 12_000 : mode === "create" ? 1_800 : MAX_ATTACHED_TEXT;
    if (effectivePrompt.length > promptLimit) {
      setComposerError(`${selectedMode.label} messages must be ${promptLimit.toLocaleString()} characters or fewer.`);
      textareaRef.current?.focus();
      return;
    }

    sendingRef.current = true;
    setSending(true);
    setComposerError(null);
    resetStreamingText();
    setStreamingAsset(null);
    setStreamingContext(null);
    setStages(initialStages(mode));
    setLiveStatus(mode === "create" ? "Starting the copy and graphic workflows." : mode === "context" ? "Reading the supplied context." : "Searching summit context.");
    nearBottomRef.current = true;

    let prepared = attachments;
    let optimisticId: string | null = null;
    let draftAccepted = false;
    let streamCompleted = false;
    let streamFailed = false;
    let streamedContent = "";
    let streamedAsset: string | null = null;
    let streamedAssetWidth: number | null = null;
    let streamedAssetHeight: number | null = null;
    let savedDocument: SavedContextDocument | null = null;
    let serverErrorMessageAdded = false;
    let streamFailureMessage: string | null = null;
    const requestController = new AbortController();
    activeRequestRef.current = requestController;

    try {
      const textAttachments = attachments
        .filter((item) => item.kind === "text")
        .map((item) => ({ name: item.file.name, content: item.text }));
      const attachedText = formatTextAttachments(textAttachments);
      if (effectivePrompt.length + attachedText.length > MAX_ATTACHED_TEXT) throw new Error("The message and attached text must total 120,000 characters or fewer.");
      prepared = await prepareAttachments(attachments, workspaceId, requestController.signal);
      const attachmentIds = prepared.flatMap((item) => item.assetId ? [item.assetId] : []);
      optimisticId = `draft-${crypto.randomUUID()}`;
      const optimisticMessage: AssistantMessage = {
        id: optimisticId,
        role: "user",
        mode,
        content: effectivePrompt,
        status: "completed",
        attachmentIds,
        textAttachments,
        contextDocumentIds: [],
        generatedAssetId: null,
        generatedAssetWidth: null,
        generatedAssetHeight: null,
        contentCampaignId: null,
        savedContextDocumentId: null,
        warnings: [],
        createdAt: new Date().toISOString()
      };
      setMessages((current) => [...current, optimisticMessage]);
      scrollToLatest(true);

      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: requestController.signal,
        body: JSON.stringify({
          workspaceId,
          input: {
            mode,
            prompt: effectivePrompt,
            attachmentIds,
            attachedText,
            textAttachments,
            sourceOfTruth: mode === "context" && sourceOfTruth
          }
        })
      });
      if (!response.ok) throw new Error(await responseError(response));
      if (!response.body) throw new Error("The assistant opened without a readable response stream.");

      await consumeNdjson(response.body, (streamEvent) => {
        if (activeRequestRef.current !== requestController) return;
        if (streamEvent.type === "accepted") {
          draftAccepted = true;
          setMessages((current) => upsertMessage(current.filter((item) => item.id !== optimisticId), streamEvent.message));
          releaseAttachments(prepared);
          setAttachments([]);
          setPrompt("");
          setSourceOfTruth(false);
          if (fileInputRef.current) fileInputRef.current.value = "";
          if (textareaRef.current) textareaRef.current.style.height = "auto";
          return;
        }
        if (streamEvent.type === "stage") {
          setStages((current) => mergeStage(current, mode, streamEvent));
          setLiveStatus(`${streamEvent.label}: ${stageStatusLabel(streamEvent.state)}.`);
          return;
        }
        if (streamEvent.type === "delta") {
          streamedContent += streamEvent.delta;
          queueStreamingText(streamedContent);
          setStages((current) => activateWritingLane(current, mode));
          return;
        }
        if (streamEvent.type === "asset") {
          streamedAsset = streamEvent.assetId;
          streamedAssetWidth = streamEvent.width;
          streamedAssetHeight = streamEvent.height;
          setStreamingAsset({ id: streamEvent.assetId, width: streamEvent.width, height: streamEvent.height });
          setStages((current) => completeLane(current, "image"));
          setLiveStatus("Graphic ready.");
          return;
        }
        if (streamEvent.type === "context_saved") {
          savedDocument = streamEvent.document;
          setStreamingContext(streamEvent.document);
          setContextDetails((current) => ({ ...current, [streamEvent.document.id]: streamEvent.document }));
          setStages((current) => completeLane(current, "save"));
          setLiveStatus(`${cleanDocumentTitle(streamEvent.document.title)} was saved to Context.`);
          return;
        }
        if (streamEvent.type === "complete") {
          streamCompleted = true;
          if (!draftAccepted) {
            draftAccepted = true;
            releaseAttachments(prepared);
            setAttachments([]);
            setPrompt("");
            setSourceOfTruth(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
            if (textareaRef.current) textareaRef.current.style.height = "auto";
          }
          setMessages((current) => upsertMessage(current.filter((item) => item.id !== optimisticId), streamEvent.message));
          setStages((current) => current.map((stage) => stage.state === "failed" ? stage : { ...stage, state: "completed" }));
          resetStreamingText();
          setStreamingAsset(null);
          setStreamingContext(null);
          setLiveStatus(`Assistant reply complete. ${announcementText(streamEvent.message.content)}`.trim());
          return;
        }
        streamFailed = true;
        streamFailureMessage = streamEvent.error;
        setComposerError(streamEvent.error);
        setStages((current) => current.map((stage) => stage.state === "active" ? { ...stage, state: "failed", detail: streamEvent.error } : stage));
        setLiveStatus(`Assistant stopped: ${streamEvent.error}`);
        if (streamEvent.message) {
          serverErrorMessageAdded = true;
          setMessages((current) => upsertMessage(current.filter((item) => item.id !== optimisticId), streamEvent.message!));
        }
      });

      if (streamFailed) throw new Error(streamFailureMessage || "The assistant could not finish this request.");
      if (!streamCompleted) throw new Error("The assistant response ended before the result was saved.");
      await workspace.refresh();
    } catch (caught) {
      requestController.abort();
      await cleanupTemporaryAttachments(prepared, workspaceId);
      if (activeRequestRef.current !== requestController) return;
      const message = caught instanceof Error ? caught.message : "The assistant could not complete this request.";
      setComposerError(message);
      setLiveStatus(`Assistant stopped: ${message}`);
      setStages((current) => current.map((stage) => stage.state === "active" ? { ...stage, state: "failed", detail: message } : stage));
      if (!draftAccepted && optimisticId) {
        setMessages((current) => current.filter((item) => item.id !== optimisticId));
      } else if (!serverErrorMessageAdded && (streamedContent || streamedAsset || savedDocument)) {
        const partialDocument = savedDocument as SavedContextDocument | null;
        const partialMessage: AssistantMessage = {
          id: `partial-${crypto.randomUUID()}`,
          role: "assistant",
          mode,
          content: streamedContent || message,
          status: "partial",
          attachmentIds: [],
          textAttachments: [],
          contextDocumentIds: partialDocument ? [partialDocument.id] : [],
          generatedAssetId: streamedAsset,
          generatedAssetWidth: streamedAssetWidth,
          generatedAssetHeight: streamedAssetHeight,
          contentCampaignId: null,
          savedContextDocumentId: partialDocument?.id || null,
          warnings: [message],
          createdAt: new Date().toISOString()
        };
        setMessages((current) => upsertMessage(current, partialMessage));
      }
    } finally {
      if (activeRequestRef.current === requestController) {
        activeRequestRef.current = null;
        sendingRef.current = false;
        setSending(false);
        resetStreamingText();
        setStreamingAsset(null);
        setStreamingContext(null);
        scrollToLatest();
      }
    }
  }

  async function clearTranscript() {
    if (!workspaceId) return;
    setClearing(true);
    setComposerError(null);
    try {
      await apiRequest<{ cleared: true }>(`/api/assistant?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "DELETE" });
      setMessages([]);
      setContextDetails({});
      setConfirmClear(false);
      setLiveStatus("Conversation cleared.");
    } catch (caught) {
      setComposerError(caught instanceof Error ? caught.message : "The conversation could not be cleared.");
      setConfirmClear(false);
    } finally {
      setClearing(false);
    }
  }

  const copyMessage = useCallback(async (message: AssistantMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      setLiveStatus("Reply copied to the clipboard.");
      window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1800);
    } catch {
      setComposerError("The reply could not be copied. Select the text and copy it manually.");
    }
  }, []);

  function handleTranscriptScroll() {
    const element = transcriptRef.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
    nearBottomRef.current = nearBottom;
    setShowJump(!nearBottom);
  }

  function resizeComposer(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 164)}px`;
  }

  function handleClearDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !clearing) {
      event.preventDefault();
      setConfirmClear(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(clearPanelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])") || []);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const canSend = !sending && !transcriptLoading && Boolean(prompt.trim() || (mode === "context" && attachments.length));
  const selectedMode = modeOption(mode);
  const SelectedModeIcon = selectedMode.icon;
  const attachmentAccept = mode === "create" ? "image/png,image/jpeg,image/webp" : "image/png,image/jpeg,image/webp,.md,.txt,text/markdown,text/plain";

  if (!workspace.state) return <PageState loading={workspace.loading} error={workspace.error} retry={workspace.refresh}/>;
  const contextDocuments = workspace.state.contextDocuments;

  return <div className="page assistant-page" aria-labelledby="assistant-title">
    <header className="assistant-page-header">
      <div>
        <span className="eyebrow">Your summit co-pilot</span>
        <h1 id="assistant-title">Summit Assistant</h1>
        <p className="lede">Research, create, and organize—without leaving your summit workspace.</p>
      </div>
      <div className="assistant-header-actions">
        <ConnectionBadge state={workspace.state}/>
        <button ref={clearTriggerRef} className="button secondary small" type="button" disabled={!messages.length || sending || clearing} onClick={() => setConfirmClear(true)}><Trash2 size={14}/>{clearing ? "Clearing…" : "Clear chat"}</button>
      </div>
    </header>

    <section className="assistant-shell" aria-label="Summit Assistant conversation" aria-busy={sending}>
      <div className="assistant-transcript" ref={transcriptRef} role="log" aria-live="off" aria-relevant="additions" onScroll={handleTranscriptScroll}>
        <div className="assistant-thread">
          {transcriptLoading ? <TranscriptSkeleton/> : transcriptError ? <div className="assistant-load-error" role="alert"><TriangleAlert/><div><strong>Conversation unavailable</strong><p>{transcriptError}</p><button className="button secondary small" onClick={() => void loadTranscript()}>Try again</button></div></div> : messages.length === 0 && !sending ? <Welcome onSelect={selectMode}/> : null}
          <SavedMessageList messages={messages} contextDocuments={contextDocuments} contextDetails={contextDetails} copiedMessageId={copiedMessageId} onCopy={copyMessage}/>
          {sending && <StreamingReply mode={mode} stages={stages} content={streamingText} asset={streamingAsset} contextDocument={streamingContext}/>} 
          <div ref={threadEndRef}/>
        </div>
        {showJump && <button className="assistant-jump" type="button" onClick={() => { nearBottomRef.current = true; setShowJump(false); scrollToLatest(true, true); }}><ArrowDown size={14}/>Jump to latest</button>}
      </div>

      <form className="assistant-composer" onSubmit={submit} onDragEnter={(event) => { event.preventDefault(); if (mode !== "ask" && !sending) setDragActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }} onDrop={(event) => { event.preventDefault(); setDragActive(false); if (!sending) void addFiles(Array.from(event.dataTransfer.files)); }}>
        <div className="assistant-composer-inner">
          <div className={`assistant-composer-card mode-${mode} ${dragActive ? "drag-active" : ""}`}>
            <div className="assistant-mode-summary">
              <span className="assistant-mode-summary-icon"><SelectedModeIcon size={17} aria-hidden="true"/></span>
              <span><strong>{selectedMode.label}</strong><small>{selectedMode.description}</small></span>
              {mode === "context" && <label className="assistant-source-toggle"><input type="checkbox" checked={sourceOfTruth} disabled={sending} onChange={(event) => setSourceOfTruth(event.target.checked)}/><span><strong>Primary source</strong><small>Approved facts</small></span></label>}
            </div>

            {attachments.length > 0 && <div className="assistant-attachments" aria-label="Attached files">{attachments.map((attachment) => <div className={`assistant-attachment ${attachment.kind}`} key={attachment.id}>{attachment.previewUrl ? <Image unoptimized src={attachment.previewUrl} width={44} height={44} alt=""/> : <span><FileText size={17}/></span>}<span><strong>{attachment.file.name}</strong><small>{attachment.kind === "image" ? formatBytes(attachment.file.size) : `${attachment.text.length.toLocaleString()} characters`}</small></span><button type="button" disabled={sending} onClick={() => removeAttachment(attachment.id)} aria-label={`Remove ${attachment.file.name}`}><X size={14}/></button></div>)}</div>}

            <div className="assistant-editor">
              <label className="sr-only" htmlFor="assistant-prompt">Message Summit Assistant</label>
              <textarea ref={textareaRef} id="assistant-prompt" rows={1} value={prompt} maxLength={mode === "ask" ? 12_000 : mode === "create" ? 1_800 : MAX_ATTACHED_TEXT} disabled={sending} placeholder={PLACEHOLDERS[mode]} aria-describedby="assistant-composer-help assistant-composer-error" onChange={(event) => { setPrompt(event.target.value); setComposerError(null); resizeComposer(event.target); }} onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.length && mode !== "ask") { event.preventDefault(); void addFiles(files); } }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canSend) event.currentTarget.form?.requestSubmit(); } }}/>
            </div>

            <div className="assistant-composer-toolbar">
              <fieldset className="assistant-mode-switcher">
                <legend className="sr-only">Assistant mode</legend>
                {MODE_OPTIONS.map(({ value, label, icon: Icon }) => <button key={value} type="button" className={`assistant-mode-button mode-${value}`} aria-pressed={mode === value} disabled={sending} onClick={() => selectMode(value)}><Icon size={15} aria-hidden="true"/><span>{label}</span></button>)}
              </fieldset>
              <div className="assistant-composer-actions">
                {mode !== "ask" && <><input ref={fileInputRef} hidden id="assistant-attachments" type="file" multiple={mode === "context"} accept={attachmentAccept} disabled={sending} onChange={(event) => void addFiles(Array.from(event.target.files || []))}/><button className="assistant-attach-button" type="button" disabled={sending} onClick={() => fileInputRef.current?.click()} aria-label={mode === "create" ? "Attach a reference image" : "Attach images, Markdown, or text files"} title={mode === "create" ? "Attach reference image" : "Attach source material"}><Paperclip size={18}/></button></>}
                <button className="assistant-send-button" disabled={!canSend} aria-label={sending ? "Assistant is working" : `Send in ${selectedMode.label} mode`}><ArrowUp size={19}/></button>
              </div>
            </div>
          </div>
          <div className="assistant-composer-footer">
            <p id="assistant-composer-help">{mode === "ask" ? "Answers use active local context." : mode === "create" ? "Describe everything in one prompt. Platform, copy, style, logo treatment, and format are inferred · one GPT Image 2 pass." : "Text files are read locally; images are uploaded for OCR."}</p>
            <span>Enter to send · Shift+Enter for a new line</span>
          </div>
          {composerError && <p className="assistant-composer-error" id="assistant-composer-error" role="alert"><TriangleAlert size={14}/>{composerError}</p>}
        </div>
      </form>
    </section>

    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveStatus}</p>

    {confirmClear && <div className="assistant-confirm" onKeyDown={handleClearDialogKeyDown}>
      <button className="assistant-confirm-backdrop" type="button" tabIndex={-1} aria-label="Cancel clearing the conversation" onClick={() => !clearing && setConfirmClear(false)}/>
      <section ref={clearPanelRef} className="assistant-confirm-panel" role="dialog" aria-modal="true" aria-labelledby="assistant-clear-title" aria-describedby="assistant-clear-description">
        <span className="assistant-confirm-icon"><Trash2 size={19}/></span>
        <h2 id="assistant-clear-title">Clear this conversation?</h2>
        <p id="assistant-clear-description">This removes the saved Assistant transcript for this workspace. Generated content and context already added to the library stay available.</p>
        <div className="assistant-confirm-actions"><button ref={clearCancelRef} className="button secondary" type="button" disabled={clearing} onClick={() => setConfirmClear(false)}>Keep conversation</button><button className="button danger-button" type="button" disabled={clearing} onClick={() => void clearTranscript()}>{clearing ? "Clearing…" : "Clear conversation"}</button></div>
      </section>
    </div>}
  </div>;
}

function Welcome({ onSelect }: { onSelect: (mode: AssistantMode) => void }) {
  return <section className="assistant-welcome" aria-labelledby="assistant-welcome-title">
    <div className="assistant-welcome-orbit" aria-hidden="true"><span/><span/><span/></div>
    <span className="assistant-welcome-mark"><Sparkles size={25}/></span>
    <span className="eyebrow">Ready when you are</span>
    <h2 id="assistant-welcome-title">What should we make happen?</h2>
    <p>Start with a question, a creative brief, or something the team should remember. Pick a lane below, then tell me what you need.</p>
    <div className="assistant-starters">{MODE_OPTIONS.map(({ value, label, description, example, icon: Icon }, index) => <button className={`assistant-starter mode-${value}`} type="button" key={value} onClick={() => onSelect(value)}><span className="assistant-starter-number">0{index + 1}</span><span className="assistant-starter-icon"><Icon size={19}/></span><span className="assistant-starter-copy"><strong>{label}</strong><small>{description}</small><em>{example}</em></span><span className="assistant-starter-arrow"><ArrowRight size={15}/></span></button>)}</div>
  </section>;
}

const SavedMessageList = memo(function SavedMessageList({ messages, contextDocuments, contextDetails, copiedMessageId, onCopy }: {
  messages: AssistantMessage[];
  contextDocuments: SavedContextDocument[];
  contextDetails: Record<string, SavedContextDocument>;
  copiedMessageId: string | null;
  onCopy: (message: AssistantMessage) => void;
}) {
  return <>{messages.map((message) => {
    const saved = message.savedContextDocumentId ? contextDocuments.find((document) => document.id === message.savedContextDocumentId) : null;
    const contextDocument = message.savedContextDocumentId ? contextDetails[message.savedContextDocumentId] || saved || undefined : undefined;
    const sourceDocuments = message.contextDocumentIds.flatMap((id) => {
      const document = contextDocuments.find((item) => item.id === id);
      return document ? [{ id: document.id, title: document.title }] : [];
    });
    return <MessageCard key={message.id} message={message} contextDocument={contextDocument} sourceDocuments={sourceDocuments} copied={copiedMessageId === message.id} onCopy={() => void onCopy(message)}/>;
  })}</>;
});

function MessageCard({ message, contextDocument, sourceDocuments, copied, onCopy }: { message: AssistantMessage; contextDocument?: SavedContextDocument; sourceDocuments: Array<{ id: string; title: string }>; copied: boolean; onCopy: () => void }) {
  const mode = modeOption(message.mode);
  const ModeIcon = mode.icon;
  if (message.role === "user") {
    return <article className="assistant-message user" aria-label={`You, ${mode.label} mode`}>
      <div className="assistant-user-bubble">
        <span className="assistant-message-mode"><ModeIcon size={12}/>{mode.label}</span>
        <p>{message.content}</p>
        {message.attachmentIds.length > 0 && <span className="assistant-message-attachments"><Paperclip size={12}/>{message.attachmentIds.length} image reference{message.attachmentIds.length === 1 ? "" : "s"}</span>}
        {message.textAttachments.length > 0 && <div className="assistant-message-text-attachments"><span><FileText size={12}/>{message.textAttachments.length} text source{message.textAttachments.length === 1 ? "" : "s"}</span>{message.textAttachments.map((attachment, index) => <details key={`${attachment.name}-${index}`}><summary>{attachment.name}</summary><pre>{attachment.content}</pre></details>)}</div>}
      </div>
      <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
    </article>;
  }
  return <article className={`assistant-message assistant status-${message.status}`} aria-label={`Summit Assistant reply, ${message.status}`}>
    <div className="assistant-avatar" aria-hidden="true"><Sparkles size={16}/></div>
    <div className="assistant-response">
      <header><span><strong>Summit Assistant</strong><small><ModeIcon size={12}/>{mode.label}</small></span><span>{message.status !== "completed" && <span className={`badge ${message.status === "failed" ? "danger" : "warning"}`}>{message.status}</span>}<time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time></span></header>
      <MarkdownContent content={message.content}/>
      {sourceDocuments.length > 0 && <div className="assistant-sources"><span>{message.mode === "create" ? "Creative context" : "Sources"}</span>{sourceDocuments.map((document) => <Link key={document.id} href={`/context?document=${encodeURIComponent(document.id)}`}><BookOpenText size={12}/>{cleanDocumentTitle(document.title)}</Link>)}</div>}
      {message.generatedAssetId && <GeneratedAsset assetId={message.generatedAssetId} width={message.generatedAssetWidth} height={message.generatedAssetHeight} altText={imageAltText(message.content)}/>} 
      {message.savedContextDocumentId && <ContextResult document={contextDocument} documentId={message.savedContextDocumentId}/>} 
      {message.warnings.length > 0 && <div className="assistant-warnings"><TriangleAlert size={15}/><div><strong>{message.status === "failed" ? "This request stopped" : "Result notes"}</strong>{message.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div>}
      <div className="assistant-message-actions">
        {message.content && <button type="button" onClick={onCopy}>{copied ? <Check size={14}/> : <Clipboard size={14}/>} {copied ? "Copied" : "Copy"}</button>}
        {message.generatedAssetId && <a href={`/api/generated?id=${encodeURIComponent(message.generatedAssetId)}&download=1`}><Download size={14}/>Download PNG</a>}
        {message.contentCampaignId && <Link href={`/content?campaign=${encodeURIComponent(message.contentCampaignId)}`}><PenLine size={14}/>Open in Content</Link>}
        {message.savedContextDocumentId && <Link href={`/context?document=${encodeURIComponent(message.savedContextDocumentId)}`}><BookOpenText size={14}/>Open in Context</Link>}
      </div>
    </div>
  </article>;
}

function StreamingReply({ mode, stages, content, asset, contextDocument }: { mode: AssistantMode; stages: WorkflowStage[]; content: string; asset: { id: string; width: number; height: number } | null; contextDocument: SavedContextDocument | null }) {
  const option = modeOption(mode);
  const ModeIcon = option.icon;
  const activeStage = stages.find((stage) => stage.state === "active") || stages.find((stage) => stage.state === "pending");
  const orbState = assistantOrbState(mode, activeStage?.id);
  return <article className="assistant-message assistant streaming" aria-label="Summit Assistant is working" aria-busy="true">
    <div className="assistant-avatar" aria-hidden="true"><ModeIcon size={16}/></div>
    <div className="assistant-response">
      <header><span><strong>Summit Assistant</strong><small><ModeIcon size={12}/>{option.label}</small></span><span className="assistant-working-label">{orbStatusWord(orbState)}</span></header>
      <div className="assistant-thinking-focus" role="status" aria-live="polite">
        <AiThinkingOrb state={orbState} size={64} label={activeStage?.label || "Summit Assistant is working"}/>
        <span><small>{orbStatusWord(orbState)}</small><strong>{activeStage?.label || "Preparing your response"}</strong><p>{orbStatusDetail(orbState)}</p></span>
      </div>
      <WorkflowLanes stages={stages}/>
      {content ? <MarkdownContent content={content}/> : null}
      {asset && <GeneratedAsset assetId={asset.id} width={asset.width} height={asset.height} altText="Generated summit campaign graphic"/>}
      {contextDocument && <ContextResult document={contextDocument} documentId={contextDocument.id}/>} 
    </div>
  </article>;
}

function WorkflowLanes({ stages }: { stages: WorkflowStage[] }) {
  return <div className={`assistant-workflow ${stages.length > 2 ? "many" : ""}`} aria-label="Workflow progress">{stages.map((stage, index) => <div className={`assistant-workflow-lane ${stage.state}`} key={stage.id}><span className="assistant-stage-icon" aria-hidden="true">{stage.state === "completed" ? <Check size={14}/> : stage.state === "failed" ? <TriangleAlert size={14}/> : <b>{index + 1}</b>}</span><span><strong>{stage.label}</strong>{stage.detail && <small>{stage.detail}</small>}</span><em>{stageStatusLabel(stage.state)}</em></div>)}</div>;
}

function assistantOrbState(mode: AssistantMode, stageId?: string): OrbState {
  if (mode === "create") return stageId === "context" ? "searching" : stageId === "image" ? "shaping" : "composing";
  if (mode === "context") return stageId === "read" ? "listening" : stageId === "save" ? "working" : "solving";
  return stageId === "retrieve" ? "searching" : "composing";
}

function orbStatusWord(state: OrbState) {
  return ({ working: "Finishing", searching: "Searching", solving: "Organizing", listening: "Reading", composing: "Composing", shaping: "Shaping" } as const)[state];
}

function orbStatusDetail(state: OrbState) {
  return ({
    working: "Putting the final pieces in place and saving them safely.",
    searching: "Gathering the most relevant summit context for this step.",
    solving: "Connecting the details into a clear, reusable structure.",
    listening: "Reading your source material carefully before changing its form.",
    composing: "Drafting the response in the voice and format you requested.",
    shaping: "Turning the approved direction into the finished visual."
  } as const)[state];
}

const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return <div className="assistant-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={{
    img: () => null,
    a: ({ node, ...props }) => { void node; return <a {...props} target="_blank" rel="noreferrer noopener"/>; }
  }}>{content}</ReactMarkdown></div>;
});

function GeneratedAsset({ assetId, width, height, altText }: { assetId: string; width: number | null; height: number | null; altText: string }) {
  return <figure className="assistant-generated-asset"><Image unoptimized width={width || 1} height={height || 1} src={`/api/generated?id=${encodeURIComponent(assetId)}&preview=1`} alt={altText}/><figcaption><span><ImageIcon size={14}/>First-pass campaign graphic</span><span className="badge success">Ready</span></figcaption></figure>;
}

function ContextResult({ document, documentId }: { document?: SavedContextDocument | null; documentId: string }) {
  return <div className="assistant-context-result"><span className="assistant-context-icon"><BookOpenText size={17}/></span><div><span className="type-label">Saved to Context</span><strong>{document?.title || "New summit context document"}</strong>{document?.summary && <p>{document.summary}</p>}{document?.tags.length ? <div>{document.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}</div><Link href={`/context?document=${encodeURIComponent(documentId)}`} aria-label={`Open ${document?.title || "saved document"} in Context`}><ArrowRight size={16}/></Link></div>;
}

function TranscriptSkeleton() {
  return <div className="assistant-transcript-skeleton" aria-label="Loading saved conversation"><span/><span/><span/></div>;
}

function modeOption(mode: AssistantMode) {
  return MODE_OPTIONS.find((option) => option.value === mode) || MODE_OPTIONS[0];
}

function initialStages(mode: AssistantMode): WorkflowStage[] {
  if (mode === "create") return [
    { id: "context", label: "Gathering creative context", state: "active", detail: "Your request stays primary" },
    { id: "copy", label: "Planning content", state: "pending", detail: "Waiting for optional brand and event references" },
    { id: "image", label: "Creating GPT Image 2 graphic", state: "pending", detail: "Waiting for the first-pass image prompt" }
  ];
  if (mode === "context") return [
    { id: "read", label: "Reading source", state: "active" },
    { id: "structure", label: "Structuring Markdown", state: "pending" },
    { id: "save", label: "Saving context", state: "pending" }
  ];
  return [
    { id: "retrieve", label: "Searching summit context", state: "active" },
    { id: "answer", label: "Writing grounded answer", state: "pending" }
  ];
}

function mergeStage(current: WorkflowStage[], mode: AssistantMode, event: Extract<AssistantStreamEvent, { type: "stage" }>) {
  const laneId = canonicalLane(mode, event.id, event.label);
  const index = current.findIndex((stage) => stage.id === laneId || stage.id === event.id);
  const incoming: WorkflowStage = { id: index >= 0 ? current[index].id : laneId || event.id, label: event.label, state: event.state, detail: event.detail };
  if (index < 0) return [...current, incoming];
  return current.map((stage, stageIndex) => stageIndex === index ? { ...stage, ...incoming } : stage);
}

function canonicalLane(mode: AssistantMode, id: string, label: string) {
  const value = `${id} ${label}`.toLowerCase();
  if (mode === "create") {
    if (/image|graphic|visual|render/.test(value)) return "image";
    if (/copy|text|post|caption|writ/.test(value)) return "copy";
  }
  if (mode === "context") {
    if (/save|persist|context/.test(value)) return "save";
    if (/struct|markdown|summar|classif/.test(value)) return "structure";
    if (/read|extract|ocr|source|upload/.test(value)) return "read";
  }
  if (mode === "ask") {
    if (/answer|respond|writ|draft/.test(value)) return "answer";
    if (/retriev|search|context|source/.test(value)) return "retrieve";
  }
  return id;
}

function activateWritingLane(current: WorkflowStage[], mode: AssistantMode): WorkflowStage[] {
  const lane = mode === "create" ? "copy" : mode === "ask" ? "answer" : "structure";
  if (current.some((stage) => stage.id === lane && stage.state === "active")) return current;
  return current.map((stage) => stage.id === lane ? { ...stage, state: "active" as const } : stage);
}

function completeLane(current: WorkflowStage[], lane: string): WorkflowStage[] {
  return current.map((stage) => stage.id === lane ? { ...stage, state: "completed" as const } : stage);
}

function stageStatusLabel(state: WorkflowState) {
  return state === "active" ? "In progress" : state === "completed" ? "Ready" : state === "failed" ? "Stopped" : "Waiting";
}

function upsertMessage(messages: AssistantMessage[], message: AssistantMessage) {
  const existing = messages.findIndex((item) => item.id === message.id);
  if (existing < 0) return [...messages, message];
  return messages.map((item, index) => index === existing ? message : item);
}

async function consumeNdjson(stream: ReadableStream<Uint8Array>, onEvent: (event: AssistantStreamEvent) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) onEvent(JSON.parse(trimmed) as AssistantStreamEvent);
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer.trim()) as AssistantStreamEvent);
}

async function responseError(response: Response) {
  const text = await response.text();
  if (!text) return `The assistant request failed (${response.status}).`;
  try {
    const body = JSON.parse(text) as { error?: string };
    return body.error || `The assistant request failed (${response.status}).`;
  } catch {
    return text;
  }
}

function releaseAttachments(items: DraftAttachment[]) {
  for (const item of items) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
}

async function cleanupTemporaryAttachments(items: DraftAttachment[], workspaceId: string) {
  const ids = Array.from(new Set(items.flatMap((item) => item.assetId ? [item.assetId] : [])));
  await Promise.allSettled(ids.map((id) => apiRequest(`/api/assets?workspaceId=${encodeURIComponent(workspaceId)}&id=${encodeURIComponent(id)}`, { method: "DELETE" })));
}

function formatBytes(bytes: number) {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function formatTextAttachments(attachments: Array<{ name: string; content: string }>) {
  return attachments.map((attachment) => `## Attached file: ${attachment.name}\n\n${attachment.content}`).join("\n\n---\n\n");
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function imageAltText(content: string) {
  const plain = content.replace(/[#*_`>\[\]()]/g, " ").replace(/\s+/g, " ").trim();
  return plain ? `Generated campaign graphic for: ${plain.slice(0, 120)}` : "Generated summit campaign graphic";
}

function announcementText(content: string) {
  return content.replace(/[#*_`>\[\]()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 1_000);
}
