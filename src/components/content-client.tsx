"use client";

import { useState } from "react";
import Image from "next/image";
import { Check, CircleHelp, Clipboard, Download, ImageIcon, PenLine, RefreshCw, Save, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { PLATFORM_CONFIG } from "@/lib/config";
import type { AiOperation, ContentCampaign, PlatformPost } from "@/lib/types";
import { apiRequest, cleanCampaignName, cleanDocumentTitle, ConnectionBadge, PageState, formatDate, formatDateTime, useWorkspace } from "./workspace";
import { InlineOperation, useOperations } from "./operations";

export function ContentClient({ initialCampaignId = null }: { initialCampaignId?: string | null }) {
  const workspace = useWorkspace();
  const operations = useOperations();
  const [message, setMessage] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(initialCampaignId);
  const [prompt, setPrompt] = useState("");
  const [createOperationId, setCreateOperationId] = useState<string | null>(null);
  const [regenOperationId, setRegenOperationId] = useState<string | null>(null);
  const [imageOperationId, setImageOperationId] = useState<string | null>(null);
  const createOperation = operations.findOperation({ id: createOperationId, kind: "content_create", originPath: "/content" });
  const selectedRegenOperation = regenOperationId ? operations.findOperation({ id: regenOperationId }) : null;
  const selectedImageOperation = imageOperationId ? operations.findOperation({ id: imageOperationId }) : null;
  const isActive = (operation: typeof createOperation) => Boolean(operation && ["queued", "running", "cancel_requested"].includes(operation.status));

  if (!workspace.state) return <PageState loading={workspace.loading} error={workspace.error} retry={workspace.refresh}/>;
  const state = workspace.state;
  const campaign = state.contentCampaigns.find((item) => item.id === campaignId) || state.contentCampaigns.find((item) => item.status !== "failed") || state.contentCampaigns[0];
  const allPlatformTarget = campaign ? `content:regenerate:${campaign.id}:${campaign.posts.map((post) => post.platform).sort().join(",")}` : "content:regenerate:no-campaign";
  const regenOperation = selectedRegenOperation || operations.findOperation({ kind: "content_regenerate", targetPrefix: allPlatformTarget });
  const imageOperation = selectedImageOperation || operations.findOperation({ kind: "content_image", targetPrefix: `content:image:${campaign?.id || "no-campaign"}` });

  async function generateCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const cleanedPrompt = prompt.trim();
    if (!cleanedPrompt) return;
    try {
      const operation = await operations.startOperation("/api/content", { method: "POST", body: JSON.stringify({ prompt: cleanedPrompt }) });
      setCreateOperationId(operation.id);
      setPrompt("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Campaign creation could not be started.");
    }
  }

  async function regenerateAll(item: ContentCampaign) {
    setMessage(null);
    try {
      const operation = await operations.startOperation("/api/content/regenerate", { method: "POST", body: JSON.stringify({ campaignId: item.id, platforms: item.posts.map((post) => post.platform) }) });
      setRegenOperationId(operation.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Campaign regeneration could not be started.");
    }
  }

  async function retryGraphic(item: ContentCampaign) {
    setMessage(null);
    try {
      const operation = await operations.startOperation("/api/content/image", { method: "POST", body: JSON.stringify({ campaignId: item.id }) });
      setImageOperationId(operation.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Graphic generation could not be started. Your saved content was not changed.");
    }
  }

  return <div className="page content-page">
    <header className="page-header split"><div><span className="eyebrow">Prompt-first campaigns</span><h1>Content</h1><p className="lede">Describe the campaign once. The system infers the structure, drafts the right posts, and asks GPT Image 2 to render the complete graphic—including copy and logo—in one pass.</p></div><ConnectionBadge state={state}/></header>
    {message && <div className={message.toLowerCase().includes("failed") ? "notice danger" : "notice"} role="status">{message}</div>}

    <section className="panel campaign-prompt-panel">
      <div className="panel-heading"><div><span className="campaign-prompt-icon"><Sparkles size={18}/></span><div><h2>Create a campaign</h2><p className="muted">One prompt is enough. Details are inferred from your request and summit context.</p></div></div><span className="credit-note">{state.demoMode ? "Demo provider" : "Uses text and image API credits"}</span></div>
      <form className="campaign-prompt-form" onSubmit={generateCampaign}>
        <div className="campaign-prompt-label-row"><label htmlFor="campaign-prompt">What do you want to create?</label><span className="campaign-prompt-help"><button type="button" aria-label="What to include in a campaign prompt" aria-describedby="campaign-prompt-tip"><CircleHelp size={16}/></button><span id="campaign-prompt-tip" role="tooltip">Useful details can include the goal, audience, platform, exact wording, must-use facts, visual mood, people or objects to show, exclusions, and an aspect ratio. Leave anything out and it will be inferred from active summit context.</span></span></div>
        <textarea id="campaign-prompt" name="prompt" rows={7} maxLength={6000} required value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Example: Announce that registration is open for AGI Summit. Make it feel ambitious but credible, aimed at AI builders and researchers. Create posts for X, LinkedIn, and Instagram, plus a bold 4:5 graphic with the official logo and the exact words “Registration is open.”"/>
        <div className="campaign-prompt-footer"><p>Active event facts, brand guidance, platform style, logo, and visual references are selected automatically.</p><button className="button campaign-create-button" disabled={isActive(createOperation) || !prompt.trim()}><Sparkles size={17}/>{isActive(createOperation) ? "Creating campaign…" : "Create campaign"}</button></div>
      </form>
      <InlineOperation operation={createOperation}/>
    </section>

    <section className="section-block"><div className="section-heading split"><div><span className="type-label">Campaign workspace</span><h2>{campaign ? cleanCampaignName(campaign.name) : "No saved campaign"}</h2></div><div className="row-actions">{campaign && campaign.posts.length > 0 && <button className="button secondary small" disabled={isActive(regenOperation)} onClick={() => void regenerateAll(campaign)}><RefreshCw size={14}/>{isActive(regenOperation) ? "Regenerating…" : "Regenerate post copy"}</button>}{state.contentCampaigns.length > 1 && <select aria-label="Open saved campaign" value={campaign?.id || ""} onChange={(event) => setCampaignId(event.target.value)}>{state.contentCampaigns.map((item) => <option value={item.id} key={item.id}>{cleanCampaignName(item.name)} · {formatDateTime(item.updatedAt)} · {item.status.replaceAll("_", " ")}</option>)}</select>}</div></div>
      <InlineOperation operation={regenOperation} compact/>
      {campaign && <SavedContextSummary campaign={campaign} documents={state.contextDocuments}/>}
      {campaign?.warnings.length ? <div className="campaign-notes"><TriangleAlert size={15}/><div>{campaign.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div> : null}
      {campaign?.status === "failed" ? <div className="empty-state danger"><TriangleAlert/><h3>This campaign stopped before a plan was ready</h3><p>{campaign.error || "Content generation did not complete."}</p><p>The failed run remains saved for inspection and did not replace an earlier campaign.</p></div> : campaign ? <div className={`content-workspace ${campaign.posts.length === 1 ? "single-post" : ""}`}><div className="platform-grid">{campaign.posts.map((post) => <PostEditor key={`${post.id}-${post.version}`} post={post} onRefresh={workspace.refresh} onMessage={setMessage}/>)}</div><ImageResult campaign={campaign} operation={imageOperation} onRetry={retryGraphic} onRefresh={workspace.refresh} onMessage={setMessage}/></div> : <div className="empty-state"><PenLine size={28}/><h3>Start with a prompt</h3><p>Describe the outcome in your own words. Campaign fields, platform targets, copy, art direction, and brand treatment will be inferred.</p></div>}
    </section>
  </div>;
}

function PostEditor({ post, onRefresh, onMessage }: { post: PlatformPost; onRefresh: () => Promise<void>; onMessage: (value: string) => void }) {
  const [text, setText] = useState(post.text);
  const [hook, setHook] = useState(post.hook);
  const [callToAction, setCallToAction] = useState(post.callToAction);
  const [hashtags, setHashtags] = useState(post.hashtags);
  const [alt, setAlt] = useState(post.imageAltText);
  const operations = useOperations();
  const [operationId, setOperationId] = useState<string | null>(null);
  const operation = operations.findOperation({ id: operationId, kind: "content_regenerate", targetPrefix: `content:regenerate:${post.campaignId}:${post.platform}` });
  const busy = Boolean(operation && ["queued", "running", "cancel_requested"].includes(operation.status));
  const config = PLATFORM_CONFIG[post.platform];

  async function save(review = false) {
    try {
      await apiRequest("/api/content/post", { method: "PATCH", body: JSON.stringify({ id: post.id, text, hook, callToAction, hashtags, imageAltText: alt, ...(review ? { reviewStatus: "reviewed" } : {}) }) });
      onMessage(review ? `${config.label} draft marked reviewed.` : `${config.label} draft saved.`);
      await onRefresh();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Could not save the post.");
    }
  }

  async function regenerate() {
    onMessage("");
    try {
      const started = await operations.startOperation("/api/content/regenerate", { method: "POST", body: JSON.stringify({ campaignId: post.campaignId, platform: post.platform }) });
      setOperationId(started.id);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Regeneration could not be started.");
    }
  }

  return <article className={`platform-card ${busy ? "operation-active" : ""}`}><div className="platform-heading"><div><span className="platform-mark">{post.platform === "x" ? "X" : post.platform === "linkedin" ? "Li" : post.platform === "instagram" ? "Ig" : "Any"}</span><div><h3>{config.label}</h3><small>Version {post.version} · {post.styleGuideStatus.replaceAll("_", " ")}</small></div></div><span className={text.length > config.characterLimit ? "count over" : "count"}>{text.length}/{config.characterLimit}</span></div>
    <label>Hook<input value={hook} onChange={(event) => setHook(event.target.value)}/></label><label>Post text<textarea rows={post.platform === "x" ? 7 : 11} value={text} onChange={(event) => setText(event.target.value)}/></label><label>Call to action<input value={callToAction} onChange={(event) => setCallToAction(event.target.value)}/></label><label>Hashtags<input value={hashtags} onChange={(event) => setHashtags(event.target.value)}/></label>
    <details><summary>Accessibility</summary><div className="form-stack inner"><label>Graphic alt text<textarea rows={3} value={alt} onChange={(event) => setAlt(event.target.value)}/></label></div></details>
    {post.warnings.length > 0 && <div className="warnings"><TriangleAlert size={15}/><ul>{post.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
    <div className="row-actions wrap"><button className="button secondary small" onClick={() => void navigator.clipboard.writeText(`${text}${hashtags ? `\n\n${hashtags}` : ""}`)}><Clipboard size={14}/>Copy</button><button className="button secondary small" onClick={() => void save()}><Save size={14}/>Save</button><button className="button secondary small" disabled={busy} onClick={() => void regenerate()}><RefreshCw size={14}/>{busy ? "Regenerating…" : "Regenerate"}</button><button className="button small" disabled={text.length > config.characterLimit} onClick={() => void save(true)}><Check size={14}/>Review</button></div>
    <InlineOperation operation={operation} compact/>
  </article>;
}

function ImageResult({ campaign, operation, onRetry, onRefresh, onMessage }: { campaign: ContentCampaign; operation: AiOperation | null; onRetry: (campaign: ContentCampaign) => Promise<void>; onRefresh: () => Promise<void>; onMessage: (message: string) => void }) {
  const busy = Boolean(operation && ["queued", "running", "cancel_requested"].includes(operation.status));
  const assets = campaign.assets.filter((asset) => asset.kind === "composite");
  return <section className={`panel image-result-panel ${busy ? "operation-active" : ""}`}><div className="panel-heading"><div><span className="image-result-kicker"><ImageIcon size={15}/>GPT Image 2</span><h2>Campaign graphic</h2><p className="muted">The complete artwork—image, typography, and logo—is generated in one request.</p></div><button className="button secondary small" disabled={busy} onClick={() => void onRetry(campaign)}><RefreshCw size={14}/>{busy ? "Generating…" : assets.length ? "Retry graphic" : "Generate graphic"}</button></div>
    <InlineOperation operation={operation}/>
    {assets.length ? <div className="generated-gallery">{assets.map((asset, index) => <figure key={asset.id}><Image unoptimized loading={index === 0 ? "eager" : "lazy"} width={asset.width} height={asset.height} src={`/api/generated?id=${asset.id}&preview=1`} alt={campaign.posts[0]?.imageAltText || "Generated campaign graphic"}/><figcaption><span className="asset-output-details"><span>{asset.width}×{asset.height} · {formatDate(asset.createdAt)}</span><span className="badge success">One-shot</span></span><span className="row-actions"><a className="button secondary small" href={`/api/generated?id=${asset.id}&download=1`}><Download size={14}/>PNG</a><button className="icon-button danger-text" aria-label="Delete generated graphic" onClick={async () => { if (!confirm("Delete this generated graphic?")) return; try { await apiRequest(`/api/generated?id=${asset.id}`, { method: "DELETE" }); onMessage("Generated graphic deleted."); await onRefresh(); } catch (error) { onMessage(error instanceof Error ? error.message : "Could not delete the graphic."); } }}><Trash2 size={14}/></button></span></figcaption></figure>)}</div> : <div className="graphic-empty"><ImageIcon size={25}/><strong>No graphic yet</strong><p>The content plan is safe. Generate one first-pass image or retry after correcting a provider or connection error.</p></div>}
    <p className="one-shot-note">Each click makes exactly one GPT Image 2 request. The result is saved as returned; no visual QA, rejection, or automatic retry runs.</p>
  </section>;
}

function SavedContextSummary({ campaign, documents }: { campaign: ContentCampaign; documents: Array<{ id: string; title: string; body: string; active: boolean }> }) {
  const selected = campaign.contextDocumentIds.map((id) => documents.find((document) => document.id === id));
  const activeSize = selected.reduce((sum, document) => sum + (document?.active ? document.body.length : 0), 0);
  return <details className="saved-context-summary"><summary>Context selected automatically · {selected.filter((document) => document?.active).length} active documents</summary><ul>{selected.map((document, index) => <li key={campaign.contextDocumentIds[index]}>{document ? `${cleanDocumentTitle(document.title)}${document.active ? "" : " (inactive — excluded from regeneration)"}` : "Deleted context — excluded from regeneration"}</li>)}{activeSize > 0 && <li className="technical-detail">Combined context size: approximately {activeSize.toLocaleString()} characters</li>}</ul></details>;
}
