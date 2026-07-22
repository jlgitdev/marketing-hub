"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { BookOpenText, FilePlus2, ImagePlus, PencilLine, Trash2, Upload, X } from "lucide-react";
import { SUGGESTED_CONTEXT_CATEGORIES, type ContextDocument } from "@/lib/types";
import { apiRequest, ConnectionBadge, PageState, formatDate, useWorkspace } from "./workspace";

const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());

export function ContextClient({ requestedDocumentId = null }: { requestedDocumentId?: string | null }) {
  const workspace = useWorkspace();
  const [editing, setEditing] = useState<ContextDocument | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const documentRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!requestedDocumentId) return;
    const element = documentRefs.current.get(requestedDocumentId);
    if (!element) return;
    const frame = window.requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      element.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedDocumentId, workspace.state?.activeWorkspace.id, workspace.state?.contextDocuments.length]);

  if (!workspace.state) return <PageState loading={workspace.loading} error={workspace.error} retry={workspace.refresh}/>;
  const state = workspace.state;
  const conflictingEventBriefs = state.contextDocuments.filter((document) => document.active && (document.sourceOfTruth || document.type === "event_information" || /event/i.test(document.type)));
  const conflictingSourcesOfTruth = conflictingEventBriefs.filter((document) => document.sourceOfTruth);

  async function submitDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null);
    const formElement = event.currentTarget; const form = new FormData(formElement);
    try {
      await apiRequest("/api/context", { method: editing ? "PATCH" : "POST", body: JSON.stringify({ ...(editing ? { id: editing.id } : {}), title: form.get("title"), type: form.get("type"), body: form.get("body"), notes: form.get("notes"), active: form.get("active") === "on", sourceOfTruth: form.get("sourceOfTruth") === "on" }) });
      setEditing(null); formElement.reset(); setMessage(editing ? "Document saved." : "Document added to the context library."); await workspace.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the document."); } finally { setBusy(false); }
  }

  async function uploadText(files: FileList | null) {
    if (!files?.length) return; setBusy(true); setMessage(null);
    try {
      for (const file of Array.from(files)) {
        if (!/\.(md|txt)$/i.test(file.name) || file.size > 1_000_000) throw new Error(`${file.name}: only .md/.txt files up to 1 MB are accepted.`);
        await apiRequest("/api/context", { method: "POST", body: JSON.stringify({ title: file.name.replace(/\.(md|txt)$/i, ""), type: "auto", body: await file.text(), active: true, sourceOfTruth: false, notes: `Uploaded from ${file.name}` }) });
      }
      setMessage(`${files.length} document${files.length === 1 ? "" : "s"} uploaded. Classify them before using AI.`); await workspace.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload failed."); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function remove(id: string, kind: "document" | "asset") {
    if (!confirm(`Delete this ${kind}? This cannot be undone.`)) return;
    try { await apiRequest(kind === "document" ? `/api/context?id=${id}` : `/api/assets?workspaceId=${encodeURIComponent(state.activeWorkspace.id)}&id=${encodeURIComponent(id)}`, { method: "DELETE" }); await workspace.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Delete failed."); }
  }

  async function uploadAsset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null); const formElement = event.currentTarget;
    try { const form = new FormData(formElement); form.set("workspaceId", state.activeWorkspace.id); await apiRequest("/api/assets", { method: "POST", body: form }); formElement.reset(); setMessage("Visual asset saved locally."); await workspace.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Asset upload failed."); } finally { setBusy(false); }
  }

  async function toggleAsset(id: string, active: boolean) {
    try { await apiRequest("/api/assets", { method: "PATCH", body: JSON.stringify({ workspaceId: state.activeWorkspace.id, id, active }) }); setMessage(active ? "Asset enabled." : "Asset disabled."); await workspace.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update the asset."); }
  }

  return <div className="page">
    <header className="page-header split"><div><h1>Context</h1><p className="lede">Add any Markdown or text resource. Marketing Hub classifies it, tags it, and automatically selects only relevant local context when a workflow runs.</p></div><ConnectionBadge state={state}/></header>
    {message && <div className={message.toLowerCase().includes("failed") || message.toLowerCase().includes("could not") ? "notice danger" : "notice"} role="status">{message}</div>}
    {conflictingEventBriefs.length > 1 && conflictingSourcesOfTruth.length !== 1 && <div className="notice danger" role="alert">Multiple active event-information documents need exactly one source of truth. Mark only the approved primary source so conflicting dates or locations are not silently chosen.</div>}
    <div className="grid context-layout">
      <section className="panel sticky-panel"><div className="panel-heading"><div><h2>{editing ? "Edit document" : "Add a document"}</h2>{editing && <p className="muted">{editing.title}</p>}</div>{editing && <button className="icon-button" onClick={() => setEditing(null)} aria-label="Cancel editing"><X size={16}/></button>}</div>
        <form className="form-stack" onSubmit={submitDocument} key={editing?.id || "new"}>
          <label>Title<input name="title" required maxLength={160} defaultValue={editing?.title}/></label>
          <label>Category<input name="type" list="context-categories" defaultValue={editing?.type || "auto"} placeholder="auto or any category name"/><small>Use <strong>auto</strong> to infer a category from the filename and contents, or enter any custom category.</small></label>
          <datalist id="context-categories"><option value="auto">Automatic</option>{SUGGESTED_CONTEXT_CATEGORIES.map((type) => <option key={type} value={type}>{label(type)}</option>)}</datalist>
          <label>Markdown or plain text<textarea name="body" rows={10} defaultValue={editing?.body} placeholder="# Event name&#10;&#10;Date, location, audience, and approved details…"/><small>Blank documents are allowed and can be completed later.</small></label>
          <label>Internal notes<input name="notes" maxLength={500} defaultValue={editing?.notes}/></label>
          <div className="check-row"><label className="check"><input type="checkbox" name="active" defaultChecked={editing?.active ?? true}/>Active</label><label className="check"><input type="checkbox" name="sourceOfTruth" defaultChecked={editing?.sourceOfTruth}/>Source of truth</label></div>
          <button className="button" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add document"}</button>
        </form>
        <div className="divider"><span>or upload</span></div>
        <input ref={fileRef} type="file" accept=".md,.txt,text/markdown,text/plain" multiple hidden onChange={(event) => void uploadText(event.target.files)}/>
        <button className="button secondary full" type="button" disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={16}/>Upload .md or .txt</button>
      </section>
      <section><div className="section-heading"><h2>Documents</h2><span className="muted">{state.contextDocuments.length} saved · {state.counts.activeContext} active</span></div>
        {state.contextDocuments.length ? <div className="document-list">{state.contextDocuments.map((document) => <article ref={(node) => { if (node) documentRefs.current.set(document.id, node); else documentRefs.current.delete(document.id); }} className={`document-card ${requestedDocumentId === document.id ? "context-targeted" : ""}`} tabIndex={requestedDocumentId === document.id ? -1 : undefined} key={document.id}><div className="document-top"><div><span className="type-label">{label(document.type)}</span>{document.sourceOfTruth && <span className="badge success">Primary source of truth</span>} {!document.active && <span className="badge">Inactive</span>} {document.origin === "project_asset" && <span className="badge">Project asset</span>}<h3>{document.title}</h3><small>Updated {formatDate(document.updatedAt)}</small><p className="context-summary">{document.summary}</p><div className="metadata-chips">{document.platforms.map((platform) => <span key={platform}>{platform}</span>)}{document.purposes.map((purpose) => <span key={purpose}>{purpose.replaceAll("_", " ")}</span>)}</div></div><div className="row-actions"><button className="icon-button" onClick={() => setEditing(document)} aria-label={`Edit ${document.title}`}><PencilLine size={16}/></button><button className="icon-button danger-text" onClick={() => void remove(document.id, "document")} aria-label={`Delete ${document.title}`}><Trash2 size={16}/></button></div></div><DocumentPreview body={document.body}/></article>)}</div> : <div className="empty-state"><BookOpenText/><h3>No context yet</h3><p>Add or upload any resource; filenames and contents are used to classify and retrieve it automatically.</p></div>}
        <div className="section-heading asset-heading"><h2>Brand assets</h2></div>
        <form className="asset-upload" onSubmit={uploadAsset}><label>Title<input name="title" required placeholder="Primary event logo"/></label><label>Asset type<select name="type" defaultValue="logo"><option value="logo">Logo</option><option value="event_art">Event artwork</option><option value="visual_reference">Visual reference</option><option value="partner_mark">Partner mark</option></select></label><label>Image<input name="file" type="file" required accept="image/png,image/jpeg,image/webp"/></label><button className="button secondary" disabled={busy}><ImagePlus size={16}/>Add asset</button></form>
        {state.brandAssets.filter((asset) => asset.type !== "assistant_attachment").length ? <div className="asset-grid">{state.brandAssets.filter((asset) => asset.type !== "assistant_attachment").map((asset) => <article className="asset-card" key={asset.id}><Image unoptimized width={58} height={48} src={`/api/assets?workspaceId=${encodeURIComponent(state.activeWorkspace.id)}&id=${encodeURIComponent(asset.id)}&preview=1`} alt={asset.title}/><div><strong>{asset.title}</strong><small>{asset.width}×{asset.height} · {(asset.sizeBytes/1024).toFixed(0)} KB</small><span className="badge success">C2PA stripped</span><button className="subtle-link inline-button" onClick={() => void toggleAsset(asset.id, !asset.active)}>{asset.active ? "Disable" : "Enable"}</button></div><button className="icon-button danger-text" onClick={() => void remove(asset.id, "asset")} aria-label={`Delete ${asset.title}`}><Trash2 size={16}/></button></article>)}</div> : <div className="compact-empty"><FilePlus2/><p>Add an approved logo or visual reference for campaign composition.</p></div>}
      </section>
    </div>
  </div>;
}

export function DocumentPreview({ body }: { body: string }) {
  const [hasOpened, setHasOpened] = useState(false);
  return <details onToggle={(event) => { if (event.currentTarget.open) setHasOpened(true); }}><summary>Preview</summary>{hasOpened && <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{body}</ReactMarkdown></div>}</details>;
}
