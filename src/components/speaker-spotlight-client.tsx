"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Check, Clipboard, Download, MicVocal, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { apiRequest, ConnectionBadge, formatDate, PageState, useWorkspace } from "./workspace";
import { InlineOperation, useOperations } from "./operations";

const defaults = {
  eventName: "AGI Summit SF 2026", eventDates: "July 18–19, 2026", eventVenue: "Palace of Fine Arts, San Francisco",
  eventWebsite: "agisummit.ai", ticketUrl: "https://luma.com/agisummit2026?coupon=JAMES",
  discountCopy: "15% off automatically applied through the link", siteDirectory: "agi-summit-site"
};

export function SpeakerSpotlightClient({ initialBatchId = null }: { initialBatchId?: string | null }) {
  const workspace = useWorkspace();
  const operations = useOperations();
  const [message, setMessage] = useState<string | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(initialBatchId);
  const [copied, setCopied] = useState<string | null>(null);
  const [batchOperationId, setBatchOperationId] = useState<string | null>(null);
  const [retryOperationIds, setRetryOperationIds] = useState<Record<string, string>>({});
  const [approvingResultId, setApprovingResultId] = useState<string | null>(null);
  const [campaignDefaults, setCampaignDefaults] = useState(defaults);
  const batchOperation = operations.findOperation({ id: batchOperationId, kind: "spotlight_batch", originPath: "/speaker-spotlight" });
  const batchBusy = Boolean(batchOperation && ["queued", "running", "cancel_requested"].includes(batchOperation.status));
  const batches = useMemo(() => workspace.state?.speakerSpotlightBatches || [], [workspace.state?.speakerSpotlightBatches]);
  const completedOperationBatchId = batchOperation?.resultEntityId && ["completed", "partially_completed", "failed"].includes(batchOperation.status) ? batchOperation.resultEntityId : null;
  const activeBatch = useMemo(() => batches.find((batch) => batch.id === (completedOperationBatchId || activeBatchId)) || batches[0] || null, [batches, activeBatchId, completedOperationBatchId]);
  useEffect(() => { void apiRequest<{ defaults: typeof defaults }>("/api/speaker-spotlights").then((response) => setCampaignDefaults(response.defaults)).catch(() => undefined); }, []);
  if (!workspace.state) return <PageState loading={workspace.loading} error={workspace.error} retry={workspace.refresh}/>;
  const state = workspace.state;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null);
    const form = new FormData(event.currentTarget);
    const speakerNames = String(form.get("speakerNames") || "").split(/[\n,]+/).map((name) => name.trim()).filter(Boolean);
    try {
      const operation = await operations.startOperation("/api/speaker-spotlights", { method: "POST", body: JSON.stringify({ speakerNames, config: { eventName: form.get("eventName"), eventDates: form.get("eventDates"), eventVenue: form.get("eventVenue"), eventWebsite: form.get("eventWebsite"), ticketUrl: form.get("ticketUrl"), discountCopy: form.get("discountCopy"), siteDirectory: form.get("siteDirectory") } }) });
      setBatchOperationId(operation.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Speaker Spotlight generation could not be started."); }
  }

  async function removeBatch(batchId: string) {
    if (!confirm("Delete this Speaker Spotlight batch and its local output files?")) return;
    try { await apiRequest(`/api/speaker-spotlights?id=${batchId}`, { method: "DELETE" }); setActiveBatchId(null); await workspace.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not delete the batch."); }
  }

  async function copyPost(id: string, post: string) {
    await navigator.clipboard.writeText(post); setCopied(id); window.setTimeout(() => setCopied(null), 1800);
  }

  async function retryResult(resultId: string) {
    setMessage(null);
    try {
      const operation = await operations.startOperation("/api/speaker-spotlights", { method: "PATCH", body: JSON.stringify({ resultId }) });
      setRetryOperationIds((current) => ({ ...current, [resultId]: operation.id }));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not start the Speaker Spotlight retry."); }
  }

  async function approveResult(resultId: string) {
    if (!confirm("Approve this saved image and mark the speaker package completed? The automated QA notes will remain in the audit record.")) return;
    setMessage(null); setApprovingResultId(resultId);
    try {
      await apiRequest("/api/speaker-spotlights", { method: "PUT", body: JSON.stringify({ resultId, decision: "approve" }) });
      await workspace.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not approve the Speaker Spotlight image."); }
    finally { setApprovingResultId(null); }
  }

  return <div className="page">
    <header className="page-header split"><div><h1>Speaker Spotlight</h1><p className="lede">Enter one name or a batch. The workflow verifies each profile and headshot, then personalizes the Palace of Fine Arts poster while preserving the summit branding, landmark backdrop, and campaign headline.</p></div><ConnectionBadge state={state}/></header>
    {message && <div className={message.toLowerCase().includes("failed") || message.toLowerCase().includes("could not") ? "notice danger" : "notice"} role="status">{message}</div>}
    <section className="panel spotlight-form-panel">
      <div className="panel-heading"><h2>New batch</h2><span className="credit-note">One image and caption per name</span></div>
      <form className="form-grid" onSubmit={submit} key={campaignDefaults.siteDirectory}>
        <label className="span-two">Speaker names<textarea name="speakerNames" rows={5} required placeholder={"Yuandong Tian\nJoe Palermo\nEhsan Adeli"}/><small>Use one name per line or separate names with commas. The downloaded site supplies the verified portrait and profile facts; the template keeps the Bay AI Circle and AGI Summit branding fixed.</small></label>
        <details className="advanced span-two"><summary>Campaign and source configuration</summary><div className="form-grid inner">
          <label>Event name<input name="eventName" defaultValue={campaignDefaults.eventName} required/></label><label>Dates<input name="eventDates" defaultValue={campaignDefaults.eventDates} required/></label>
          <label>Venue<input name="eventVenue" defaultValue={campaignDefaults.eventVenue} required/></label><label>Website<input name="eventWebsite" defaultValue={campaignDefaults.eventWebsite} required/></label>
          <label>Ticket URL<input name="ticketUrl" type="url" defaultValue={campaignDefaults.ticketUrl} required/></label><label>Discount copy<input name="discountCopy" defaultValue={campaignDefaults.discountCopy} required/></label>
          <label className="span-two">Downloaded AGI Summit site directory<input name="siteDirectory" defaultValue={campaignDefaults.siteDirectory} required/><small>The backend dynamically locates the current index-*.js bundle and downloaded images here.</small></label>
        </div></details>
        <div className="span-two form-footer"><p>Live batches use one GPT Image 2 edit with the canonical Palace of Fine Arts poster as the primary template and the verified speaker headshot as the identity reference.</p><button className="button" disabled={batchBusy || (!state.demoMode && !state.connection.connected)}>{batchBusy ? "Building in background" : "Create Speaker Spotlights"}</button></div>
      </form>
      <InlineOperation operation={batchOperation}/>
    </section>

    {batches.length > 0 && <section className="section-block">
      <div className="section-heading split"><h2>Saved batches</h2><div className="toolbar"><select aria-label="Open Speaker Spotlight batch" value={activeBatch?.id || ""} onChange={(event) => { setBatchOperationId(null); setActiveBatchId(event.target.value); }}>{batches.map((batch) => <option key={batch.id} value={batch.id}>{formatDate(batch.createdAt)} · {batch.speakerNames.join(", ")}</option>)}</select>{activeBatch && <button className="button secondary small danger-text" onClick={() => void removeBatch(activeBatch.id)}><Trash2 size={14}/>Delete batch</button>}</div></div>
      {activeBatch && <><div className="spotlight-batch-summary"><span><strong>{activeBatch.results.filter((result) => result.status === "completed").length}</strong> completed</span><span><strong>{activeBatch.results.filter((result) => result.status === "image_review_required").length}</strong> review required</span><span><strong>{activeBatch.results.filter((result) => result.status === "failed" || result.status === "extraction_failed").length}</strong> failed</span><span><strong>{activeBatch.model}</strong> image model</span></div><div className="spotlight-results">{activeBatch.results.map((result, resultIndex) => { const retryOperation = operations.findOperation({ id: retryOperationIds[result.id] || null, kind: "spotlight_retry", targetPrefix: `spotlight:retry:${result.id}` }); const retrying = Boolean(retryOperation && ["queued", "running", "cancel_requested"].includes(retryOperation.status)); return <article className={`spotlight-result ${retrying ? "operation-active" : ""}`} key={result.id}>
        <div className="spotlight-result-heading"><div><span className={`status-icon ${result.status === "completed" ? "completed" : result.status.includes("failed") ? "failed" : ""}`}>{result.status === "completed" ? <Check size={18}/> : result.status.includes("failed") || result.status === "image_review_required" ? <TriangleAlert size={18}/> : <MicVocal size={18}/>}</span><div><h3>{result.profile?.displayName || result.inputName}</h3><small>{result.status.replaceAll("_", " ")}</small></div></div><div className="row-actions">{(result.imageAssetId || result.headshotAssetId) && <span className="badge success">C2PA stripped</span>}{result.imageAssetId && <a className="button secondary small" href={`/api/speaker-spotlights/asset?id=${result.imageAssetId}&download=1`}><Download size={14}/>Download image</a>}{result.status === "image_review_required" && <button className="button secondary small" disabled={approvingResultId === result.id} onClick={() => void approveResult(result.id)}><Check size={14}/>{approvingResultId === result.id ? "Approving…" : "Approve image"}</button>}{result.profile && result.headshotAssetId && result.imagePrompt && (result.status === "failed" || result.status === "image_review_required") && <button className="button secondary small" disabled={retrying || approvingResultId === result.id || (!state.demoMode && !state.connection.connected)} onClick={() => void retryResult(result.id)}><RotateCcw size={14}/>{retrying ? "Retrying…" : "Retry package"}</button>}</div></div>
        {result.error && <div className="warnings"><TriangleAlert/><span>{result.error}{result.providerError && <small>Stage: {result.providerError.stage.replaceAll("_", " ")}{result.providerError.requestId ? ` · Request ${result.providerError.requestId}` : ""}{result.providerError.retryable ? " · Safe to retry" : ""}</small>}</span></div>}
        {result.qa?.humanReviewApprovedAt && <div className="notice"><Check size={16}/><span>Approved after human review. Automated QA notes remain preserved in the package record.</span></div>}
        <InlineOperation operation={retryOperation} compact/>
        <div className="spotlight-output-grid"><div className="spotlight-image-wrap">{result.imageAssetId ? <Image src={`/api/speaker-spotlights/asset?id=${result.imageAssetId}`} alt={`${result.inputName} Speaker Spotlight`} width={1024} height={1536} loading={resultIndex === 0 ? "eager" : "lazy"} unoptimized/> : result.headshotAssetId ? <Image src={`/api/speaker-spotlights/asset?id=${result.headshotAssetId}`} alt={`${result.inputName} verified headshot`} width={480} height={480} loading={resultIndex === 0 ? "eager" : "lazy"} unoptimized/> : <div className="spotlight-placeholder"><MicVocal/><span>No verified image output</span></div>}</div><div className="spotlight-copy">{result.profile && <details><summary>Verified speaker data</summary><p>{result.profile.roleLine || result.profile.bio}</p><ul>{result.profile.highlights.map((highlight) => <li key={`${highlight.label}-${highlight.text}`}><strong>{highlight.label}</strong> — {highlight.text}</li>)}</ul></details>}{result.post ? <><div className="copy-heading"><strong>Cross-platform caption</strong><button className="icon-button" aria-label={`Copy ${result.inputName} caption`} onClick={() => void copyPost(result.id, result.post!)}>{copied === result.id ? <Check size={15}/> : <Clipboard size={15}/>}</button></div><pre>{result.post}</pre></> : <p className="muted-copy">No caption was approved for this speaker.</p>}</div></div>
      </article>; })}</div></>}
    </section>}
  </div>;
}
