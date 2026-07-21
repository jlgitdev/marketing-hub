"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clipboard, Download, ImagePlus, LoaderCircle, MicVocal, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import type { SpeakerSpotlightBatch, SpeakerSpotlightBatchSummary, SpeakerSpotlightTemplate } from "@/lib/types";
import { apiRequest, ConnectionBadge, formatDate, PageState, useWorkspace } from "./workspace";
import { InlineOperation, useOperations } from "./operations";

const defaults = {
  eventName: "AGI Summit SF 2026", eventDates: "July 18–19, 2026", eventVenue: "Palace of Fine Arts, San Francisco",
  eventWebsite: "agisummit.ai", ticketUrl: "https://luma.com/agisummit2026?coupon=JAMES",
  discountCopy: "15% off automatically applied through the link", siteDirectory: "agi-summit-site"
};

interface SpotlightResponse { defaults: typeof defaults; batches: SpeakerSpotlightBatchSummary[]; batch: SpeakerSpotlightBatch | null }
interface TemplateResponse { templates: SpeakerSpotlightTemplate[] }

export function SpeakerSpotlightClient({ initialBatchId = null }: { initialBatchId?: string | null }) {
  const workspace = useWorkspace();
  const operations = useOperations();
  const [message, setMessage] = useState<string | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(initialBatchId);
  const [followLatestBatch, setFollowLatestBatch] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [batchOperationId, setBatchOperationId] = useState<string | null>(null);
  const [templateOperationIds, setTemplateOperationIds] = useState<string[]>([]);
  const [retryOperationIds, setRetryOperationIds] = useState<Record<string, string>>({});
  const [templateActionId, setTemplateActionId] = useState<string | null>(null);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [campaignDefaults, setCampaignDefaults] = useState(defaults);
  const [templates, setTemplates] = useState<SpeakerSpotlightTemplate[]>([]);
  const [batches, setBatches] = useState<SpeakerSpotlightBatchSummary[]>([]);
  const [activeBatch, setActiveBatch] = useState<SpeakerSpotlightBatch | null>(null);
  const batchOperation = operations.findOperation({ id: batchOperationId, kind: "spotlight_batch", originPath: "/speaker-spotlight" });
  const batchBusy = Boolean(batchOperation && ["queued", "running", "cancel_requested"].includes(batchOperation.status));
  const selectedTemplate = templates.find((template) => template.selected && template.status === "ready") || null;

  const loadSpotlights = useCallback(async (batchId: string | null = null) => {
    const response = await apiRequest<SpotlightResponse>(batchId ? `/api/speaker-spotlights?batch=${encodeURIComponent(batchId)}` : "/api/speaker-spotlights", { cache: "no-store" });
    setCampaignDefaults(response.defaults); setBatches(response.batches); setActiveBatch(response.batch); setActiveBatchId(response.batch?.id || null);
  }, []);
  const loadTemplates = useCallback(async () => {
    const response = await apiRequest<TemplateResponse>("/api/speaker-spotlights/templates", { cache: "no-store" });
    setTemplates(response.templates);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void Promise.all([loadSpotlights(initialBatchId), loadTemplates()]).catch((error) => setMessage(error instanceof Error ? error.message : "Could not load saved Speaker Spotlights.")), 0);
    return () => window.clearTimeout(timer);
  }, [initialBatchId, loadSpotlights, loadTemplates]);

  const trackedOperations = useMemo(() => [batchOperation, ...templateOperationIds.map((id) => operations.findOperation({ id })), ...Object.values(retryOperationIds).map((id) => operations.findOperation({ id }))].filter(Boolean), [batchOperation, templateOperationIds, retryOperationIds, operations]);
  const operationUpdateKey = trackedOperations.map((operation) => `${operation!.id}:${operation!.updatedAt}:${operation!.status}`).join("|");
  useEffect(() => {
    if (!operationUpdateKey) return;
    const timer = window.setTimeout(() => {
      void Promise.all([loadTemplates(), loadSpotlights(batchOperation?.resultEntityId || (followLatestBatch ? null : activeBatchId))]).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [operationUpdateKey, batchOperation?.resultEntityId, followLatestBatch, activeBatchId, loadSpotlights, loadTemplates]);

  if (!workspace.state) return <PageState loading={workspace.loading} error={workspace.error} retry={workspace.refresh}/>;
  const state = workspace.state;

  async function submitBatch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null);
    if (!selectedTemplate) { setMessage("Create or select a ready template before generating Speaker Spotlights."); return; }
    const form = new FormData(event.currentTarget);
    const speakerNames = String(form.get("speakerNames") || "").split(/[\n,]+/).map((name) => name.trim()).filter(Boolean);
    try {
      const operation = await operations.startOperation("/api/speaker-spotlights", { method: "POST", body: JSON.stringify({ speakerNames, templateId: selectedTemplate.id, config: { eventName: form.get("eventName"), eventDates: form.get("eventDates"), eventVenue: form.get("eventVenue"), eventWebsite: form.get("eventWebsite"), ticketUrl: form.get("ticketUrl"), discountCopy: form.get("discountCopy"), siteDirectory: form.get("siteDirectory") } }) });
      setBatchOperationId(operation.id); setFollowLatestBatch(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Speaker Spotlight generation could not be started."); }
  }

  async function submitTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const operation = await operations.startOperation("/api/speaker-spotlights/templates", { method: "POST", body: form });
      setTemplateOperationIds((current) => [operation.id, ...current]); setShowTemplateForm(false); formElement.reset(); await loadTemplates();
      setMessage("Template uploaded. Analysis is running in the background; you can keep working elsewhere.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create the template."); }
  }

  async function chooseTemplate(templateId: string) {
    setMessage(null); setTemplateActionId(templateId);
    try { const response = await apiRequest<TemplateResponse>("/api/speaker-spotlights/templates", { method: "PATCH", body: JSON.stringify({ templateId }) }); setTemplates(response.templates); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not select the template."); }
    finally { setTemplateActionId(null); }
  }

  async function removeTemplate(template: SpeakerSpotlightTemplate) {
    if (!confirm(`Delete “${template.name}” and its saved reference image? Existing batches keep their pinned copy.`)) return;
    setMessage(null); setTemplateActionId(template.id);
    try { const response = await apiRequest<TemplateResponse>(`/api/speaker-spotlights/templates?id=${template.id}`, { method: "DELETE" }); setTemplates(response.templates); await workspace.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not delete the template."); }
    finally { setTemplateActionId(null); }
  }

  async function removeBatch(batchId: string) {
    if (!confirm("Delete this Speaker Spotlight batch and its local output files?")) return;
    try { await apiRequest(`/api/speaker-spotlights?id=${batchId}`, { method: "DELETE" }); setActiveBatchId(null); setFollowLatestBatch(false); await Promise.all([loadSpotlights(), workspace.refresh()]); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not delete the batch."); }
  }

  async function copyPost(id: string, post: string) { await navigator.clipboard.writeText(post); setCopied(id); window.setTimeout(() => setCopied(null), 1800); }
  async function retryResult(resultId: string, hasImage: boolean) {
    if (hasImage && !confirm("Generate a new image for this speaker? This sends one new image request and replaces the current saved image.")) return;
    setMessage(null);
    try { const operation = await operations.startOperation("/api/speaker-spotlights", { method: "PATCH", body: JSON.stringify({ resultId }) }); setRetryOperationIds((current) => ({ ...current, [resultId]: operation.id })); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not start the Speaker Spotlight retry."); }
  }

  return <div className="page">
    <header className="page-header split"><div><h1>Speaker Spotlight</h1><p className="lede">Create reusable poster templates from reference artwork, then generate verified speaker packages with the selected design. Every batch pins its template version so individual speakers can be regenerated later.</p></div><ConnectionBadge state={state}/></header>
    {message && <div className={message.toLowerCase().includes("failed") || message.toLowerCase().includes("could not") ? "notice danger" : "notice"} role="status">{message}</div>}

    <section className="panel spotlight-template-panel">
      <div className="panel-heading"><div><h2>Templates</h2><p className="muted">The selected ready template controls the image reference, analyzed prompt contract, content slots, and optional caption guidance.</p></div><button className="button secondary small" onClick={() => setShowTemplateForm((value) => !value)}><Plus size={14}/>{showTemplateForm ? "Close" : "New template"}</button></div>
      {showTemplateForm && <form className="form-grid template-create-form" onSubmit={submitTemplate}>
        <label>Template name<input name="name" required minLength={2} maxLength={120} placeholder="e.g. Neon keynote portrait"/></label>
        <label>Reference image<input name="file" type="file" accept="image/png,image/jpeg,image/webp" required/><small>PNG, JPEG, or WebP. The image is normalized to an Images API-supported square, portrait, or landscape canvas.</small></label>
        <label>Example speaker shown (optional)<input name="exampleSpeakerName" maxLength={160} placeholder="Name currently visible in the artwork"/></label>
        <label className="span-two">What must stay fixed?<textarea name="fixedGuidance" rows={3} required minLength={10} placeholder="Logos, campaign headline, footer, background landmark, colors…"/></label>
        <label className="span-two">What changes for each speaker?<textarea name="variableGuidance" rows={3} required minLength={10} placeholder="Portrait, name, role, highlights, biography, event details…"/></label>
        <label>Caption guidance (optional)<textarea name="captionGuidance" rows={3} placeholder="Tone or campaign framing tied to this visual series"/></label>
        <label>Additional visual guidance (optional)<textarea name="additionalGuidance" rows={3} placeholder="Cropping, hierarchy, typography, or special constraints"/></label>
        <div className="span-two form-footer"><p>OpenAI vision analyzes the uploaded artwork and writes a structured, versioned production prompt in the background.</p><button className="button" disabled={!state.demoMode && !state.connection.connected}><ImagePlus size={15}/>Upload and analyze</button></div>
      </form>}
      <div className="template-gallery">
        {templates.map((template, templateIndex) => {
          const operation = templateOperationIds.map((id) => operations.findOperation({ id })).find((item) => item?.resultEntityId === template.id || item?.targetKey === `spotlight:template:${template.id}`) || null;
          return <article className={`template-card ${template.selected ? "selected" : ""}`} key={template.id}>
            <div className="template-thumb"><Image src={`/api/speaker-spotlights/templates/asset?id=${template.id}&thumbnail=1`} alt={`${template.name} template`} fill sizes="(max-width: 560px) 100vw, 260px" loading={templateIndex === 0 ? "eager" : "lazy"} style={{ objectFit: "contain" }} unoptimized/>{template.selected && <span className="template-selected-badge"><Check size={12}/>Selected</span>}</div>
            <div className="template-card-body"><div><h3>{template.name}</h3><p>v{template.version} · {template.aspectRatio} · {template.sourceType === "builtin" ? "example" : "uploaded"}</p></div><span className={`badge ${template.status === "ready" ? "success" : template.status === "failed" ? "danger" : "warning"}`}>{template.status === "analyzing" && <LoaderCircle className="spin" size={12}/>} {template.status}</span></div>
            {template.error && <p className="template-error">{template.error}</p>}
            {operation && <InlineOperation operation={operation} compact/>}
            <div className="row-actions">{template.status === "ready" && !template.selected && <button className="button secondary small" disabled={templateActionId === template.id} onClick={() => void chooseTemplate(template.id)}>Use template</button>}<button className="icon-button danger-text" disabled={templateActionId === template.id || template.status === "analyzing"} onClick={() => void removeTemplate(template)} aria-label={`Delete ${template.name}`} title={template.status === "analyzing" ? "Wait for analysis to finish before deleting" : "Delete template"}><Trash2 size={15}/></button></div>
          </article>;
        })}
        {!templates.length && <div className="empty-state compact"><ImagePlus/><h3>No templates</h3><p>Add a reference image and required guidance to enable Speaker Spotlight generation.</p></div>}
      </div>
    </section>

    <section className="panel spotlight-form-panel">
      <div className="panel-heading"><div><h2>New batch</h2><p className="muted">{selectedTemplate ? `Using ${selectedTemplate.name} v${selectedTemplate.version}` : "A ready selected template is required"}</p></div><span className="credit-note">One image and caption per name</span></div>
      <form className="form-grid" onSubmit={submitBatch} key={campaignDefaults.siteDirectory}>
        <label className="span-two">Speaker names<textarea name="speakerNames" rows={5} required placeholder={"Yuandong Tian\nJoe Palermo\nEhsan Adeli"}/><small>Use one name per line or commas. The downloaded site supplies verified portraits and profile facts.</small></label>
        <details className="advanced span-two"><summary>Campaign and source configuration</summary><div className="form-grid inner">
          <label>Event name<input name="eventName" defaultValue={campaignDefaults.eventName} required/></label><label>Dates<input name="eventDates" defaultValue={campaignDefaults.eventDates} required/></label>
          <label>Venue<input name="eventVenue" defaultValue={campaignDefaults.eventVenue} required/></label><label>Website<input name="eventWebsite" defaultValue={campaignDefaults.eventWebsite} required/></label>
          <label>Ticket URL<input name="ticketUrl" type="url" defaultValue={campaignDefaults.ticketUrl} required/></label><label>Discount copy<input name="discountCopy" defaultValue={campaignDefaults.discountCopy} required/></label>
          <label className="span-two">Downloaded AGI Summit site directory<input name="siteDirectory" defaultValue={campaignDefaults.siteDirectory} required/><small>The backend dynamically locates the current index-*.js bundle and downloaded images here.</small></label>
        </div></details>
        {!selectedTemplate && <div className="notice danger span-two"><TriangleAlert size={16}/><span>Create or select a ready template above to enable this workflow.</span></div>}
        <div className="span-two form-footer"><p>GPT Image 2 receives the pinned template as Image 1 and the verified headshot as Image 2. The first generated image is saved as the final output; any regeneration is started manually per speaker.</p><button className="button" disabled={!selectedTemplate || batchBusy || (!state.demoMode && !state.connection.connected)}>{batchBusy ? "Building in background" : "Create Speaker Spotlights"}</button></div>
      </form>
      <InlineOperation operation={batchOperation}/>
    </section>

    {batches.length > 0 && <section className="section-block">
      <div className="section-heading split spotlight-batch-heading"><h2>Saved batches</h2><div className="toolbar spotlight-batch-controls"><select className="spotlight-batch-select" aria-label="Open Speaker Spotlight batch" title={activeBatch ? `${formatDate(activeBatch.createdAt)} · ${activeBatch.speakerNames.join(", ")}` : undefined} value={activeBatch?.id || ""} onChange={(event) => { const id = event.target.value; setBatchOperationId(null); setFollowLatestBatch(false); setActiveBatchId(id); void loadSpotlights(id).catch((error) => setMessage(error instanceof Error ? error.message : "Could not open the saved batch.")); }}>{batches.map((batch) => <option key={batch.id} value={batch.id}>{formatDate(batch.createdAt)} · {batch.speakerNames.join(", ")}</option>)}</select>{activeBatch && <button className="button secondary small danger-text" onClick={() => void removeBatch(activeBatch.id)}><Trash2 size={14}/>Delete batch</button>}</div></div>
      {activeBatch && <><div className="spotlight-batch-summary"><span><strong>{activeBatch.results.filter((result) => result.status === "completed").length}</strong> completed</span><span><strong>{activeBatch.results.reduce((total, result) => total + result.retryCount, 0)}</strong> manual regenerations</span><span><strong>{activeBatch.results.filter((result) => result.status === "failed" || result.status === "extraction_failed").length}</strong> failed</span><span><strong>{activeBatch.templateSnapshot?.name || "Legacy"}</strong> template</span></div><div className="spotlight-results">{activeBatch.results.map((result, resultIndex) => { const retryOperation = operations.findOperation({ id: retryOperationIds[result.id] || null, kind: "spotlight_retry", targetPrefix: `spotlight:retry:${result.id}` }); const retrying = Boolean(retryOperation && ["queued", "running", "cancel_requested"].includes(retryOperation.status)); const canRegenerate = Boolean(result.profile && result.headshotAssetId && result.imagePrompt && ["completed", "failed", "canceled"].includes(result.status)); return <article className={`spotlight-result ${retrying ? "operation-active" : ""}`} key={result.id}>
        <div className="spotlight-result-heading"><div><span className={`status-icon ${result.status === "completed" ? "completed" : result.status.includes("failed") ? "failed" : ""}`}>{result.status === "completed" ? <Check size={18}/> : result.status.includes("failed") ? <TriangleAlert size={18}/> : <MicVocal size={18}/>}</span><div><h3>{result.profile?.displayName || result.inputName}</h3><small>{result.status.replaceAll("_", " ")}</small></div></div><div className="row-actions">{(result.imageAssetId || result.headshotAssetId) && <span className="badge success">C2PA stripped</span>}{result.imageAssetId && <a className="button secondary small" href={`/api/speaker-spotlights/asset?id=${result.imageAssetId}&download=1`}><Download size={14}/>Download image</a>}{canRegenerate && <button className="button secondary small" disabled={retrying || (!state.demoMode && !state.connection.connected)} onClick={() => void retryResult(result.id, Boolean(result.imageAssetId))}><RotateCcw size={14}/>{retrying ? "Generating…" : result.imageAssetId ? "Regenerate image" : "Retry image"}</button>}</div></div>
        {result.error && <div className="warnings"><TriangleAlert/><span>{result.error}{result.providerError && <small>Stage: {result.providerError.stage.replaceAll("_", " ")}{result.providerError.requestId ? ` · Request ${result.providerError.requestId}` : ""}{result.providerError.retryable ? " · Safe to retry" : ""}</small>}</span></div>}
        <InlineOperation operation={retryOperation} compact/>
        <div className="spotlight-output-grid"><div className="spotlight-image-wrap">{result.imageAssetId ? <Image src={`/api/speaker-spotlights/asset?id=${result.imageAssetId}&preview=1`} alt={`${result.inputName} Speaker Spotlight`} width={activeBatch.templateSnapshot?.width || 1024} height={activeBatch.templateSnapshot?.height || 1536} loading={resultIndex === 0 ? "eager" : "lazy"} unoptimized/> : result.headshotAssetId ? <Image src={`/api/speaker-spotlights/asset?id=${result.headshotAssetId}&preview=1`} alt={`${result.inputName} verified headshot`} width={480} height={480} loading={resultIndex === 0 ? "eager" : "lazy"} unoptimized/> : <div className="spotlight-placeholder"><MicVocal/><span>No image output</span></div>}</div><div className="spotlight-copy">{result.profile && <details><summary>Verified speaker data</summary><p>{result.profile.roleLine || result.profile.bio}</p><ul>{result.profile.highlights.map((highlight) => <li key={`${highlight.label}-${highlight.text}`}><strong>{highlight.label}</strong> — {highlight.text}</li>)}</ul></details>}{result.post ? <><div className="copy-heading"><strong>Cross-platform caption</strong><button className="icon-button" aria-label={`Copy ${result.inputName} caption`} onClick={() => void copyPost(result.id, result.post!)}>{copied === result.id ? <Check size={15}/> : <Clipboard size={15}/>}</button></div><pre>{result.post}</pre></> : <p className="muted-copy">No caption is available for this speaker.</p>}</div></div>
      </article>; })}</div></>}
    </section>}
  </div>;
}
