"use client";

import { useState } from "react";
import Image from "next/image";
import { Check, Clipboard, Download, ImageIcon, PenLine, RefreshCw, Save, Trash2, TriangleAlert } from "lucide-react";
import { PLATFORM_CONFIG } from "@/lib/config";
import type { AiOperation, ContentCampaign, Platform, PlatformPost } from "@/lib/types";
import { apiRequest, ConnectionBadge, PageState, formatDate, useWorkspace } from "./workspace";
import { ContextPicker } from "./context-picker";
import { InlineOperation, useOperations } from "./operations";

export function ContentClient({ initialCampaignId = null }: { initialCampaignId?: string | null }) {
  const workspace = useWorkspace();
  const operations = useOperations();
  const [message, setMessage] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(initialCampaignId);
  const [createOperationId, setCreateOperationId] = useState<string | null>(null);
  const [regenOperationId, setRegenOperationId] = useState<string | null>(null);
  const [imageOperationId, setImageOperationId] = useState<string | null>(null);
  const createOperation = operations.findOperation({ id: createOperationId, kind: "content_create", originPath: "/content" });
  const selectedRegenOperation = regenOperationId ? operations.findOperation({ id: regenOperationId }) : null;
  const selectedImageOperation = imageOperationId ? operations.findOperation({ id: imageOperationId }) : null;
  const isActive = (operation: typeof createOperation) => Boolean(operation && ["queued", "running", "cancel_requested"].includes(operation.status));
  if (!workspace.state) return <PageState loading={workspace.loading} error={workspace.error} retry={workspace.refresh}/>;
  const state = workspace.state;
  const activeContext = state.contextDocuments.filter((document) => document.active);
  const campaign = state.contentCampaigns.find((item) => item.id === campaignId) || state.contentCampaigns.find((item) => item.status !== "failed") || state.contentCampaigns[0];
  const allPlatformTarget = campaign ? `content:regenerate:${campaign.id}:${campaign.posts.map((post) => post.platform).sort().join(",")}` : "content:regenerate:no-campaign";
  const regenOperation = selectedRegenOperation || operations.findOperation({ kind: "content_regenerate", targetPrefix: allPlatformTarget });
  const imageOperation = selectedImageOperation || operations.findOperation({ kind: "content_image", targetPrefix: `content:image:${campaign?.id || "no-campaign"}` });

  async function generateCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const operation = await operations.startOperation("/api/content", { method: "POST", body: JSON.stringify({ name: form.get("name"), brief: form.get("brief"), objective: form.get("objective"), audience: form.get("audience"), callToAction: form.get("callToAction"), requiredPhrases: form.get("requiredPhrases"), prohibitedPhrases: form.get("prohibitedPhrases"), headline: form.get("headline"), imageDirection: form.get("imageDirection"), imageGenerationEnabled: form.get("imageGenerationEnabled") === "on", selectedBrandAssetId: form.get("selectedBrandAssetId") || null, contextDocumentIds: form.getAll("contextDocumentIds"), contextMode: form.get("contextMode"), platforms: form.getAll("platforms") }) });
      setCreateOperationId(operation.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Content generation could not be started."); }
  }

  async function regenerateAll(campaign: ContentCampaign) {
    setMessage(null);
    try {
      const operation = await operations.startOperation("/api/content/regenerate", { method: "POST", body: JSON.stringify({ campaignId: campaign.id, platforms: campaign.posts.map((post) => post.platform) }) });
      setRegenOperationId(operation.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Campaign regeneration could not be started."); }
  }

  async function generateImage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const operation = await operations.startOperation("/api/content/image", { method: "POST", body: JSON.stringify({ campaignId: form.get("campaignId"), platform: form.get("platform"), prompt: form.get("prompt"), headline: form.get("headline"), subheadline: form.get("subheadline"), footer: form.get("footer"), logoAssetId: form.get("logoAssetId") || null, logoPlacement: form.get("logoPlacement"), baseAssetId: form.get("baseAssetId") || null }) });
      setImageOperationId(operation.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Image generation could not be started. Your saved posts were not changed."); }
  }

  return <div className="page">
    <header className="page-header split"><div><h1>Content</h1><p className="lede">Write one campaign for X, LinkedIn, and Instagram from selected brand and platform guides, with exact campaign text rendered in application code.</p></div><ConnectionBadge state={state}/></header>
    {message && <div className={message.toLowerCase().includes("failed") ? "notice danger" : "notice"} role="status">{message}</div>}
    <section className="panel"><div className="panel-heading"><h2>New campaign</h2><span className="credit-note">{state.demoMode ? "Demo provider" : "Generation uses API credits"}</span></div>
      <form className="form-grid" onSubmit={generateCampaign}>
        <label>Campaign name<input name="name" required defaultValue="Applied Intelligence Forum launch"/></label><label>Objective<input name="objective" required defaultValue="Drive qualified event registrations"/></label>
        <label className="span-two">Creative brief<textarea name="brief" rows={3} required defaultValue="Introduce the event as a practical gathering for builders, researchers, educators, and community leaders working on responsible AI."/></label>
        <label>Target audience<input name="audience" required defaultValue="Bay Area AI builders, researchers, founders, and community leaders"/></label><label>Call to action<input name="callToAction" required defaultValue="Explore the program and reserve a place"/></label>
        <label>Required phrases<input name="requiredPhrases" placeholder="Optional approved phrase"/></label><label>Prohibited phrases<input name="prohibitedPhrases" placeholder="revolutionary, once-in-a-lifetime"/></label>
        <label>Optional image headline<input name="headline" placeholder="Applied Intelligence Forum"/></label><label>Image direction<input name="imageDirection" placeholder="Calm cobalt editorial visual with warm human detail"/></label><label>Selected logo or visual reference<select name="selectedBrandAssetId" defaultValue=""><option value="">No preselected asset</option>{state.brandAssets.filter((asset) => asset.active).map((asset) => <option value={asset.id} key={asset.id}>{asset.title}</option>)}</select></label><label className="check image-toggle"><input name="imageGenerationEnabled" type="checkbox" defaultChecked/>Enable campaign image generation for this campaign</label>
        <fieldset><legend>Platforms</legend><div className="check-row"><label className="check"><input name="platforms" value="x" type="checkbox" defaultChecked/>X</label><label className="check"><input name="platforms" value="linkedin" type="checkbox" defaultChecked/>LinkedIn</label><label className="check"><input name="platforms" value="instagram" type="checkbox" defaultChecked/>Instagram</label></div></fieldset>
        <fieldset className="span-two"><legend>Selected context <span>Only checked documents are sent</span></legend><ContextPicker documents={activeContext}/></fieldset>
        <div className="span-two form-footer"><p>Missing platform guides use a restrained fallback and are labeled.</p><button className="button" disabled={isActive(createOperation) || !activeContext.length}>{isActive(createOperation) ? "Building in background" : "Generate platform drafts"}</button></div>
      </form>
      <InlineOperation operation={createOperation}/>
    </section>
    <section className="section-block"><div className="section-heading split"><div><span className="type-label">Campaign workspace</span><h2>{campaign ? campaign.name : "No saved campaign"}</h2></div><div className="row-actions">{campaign && <button className="button secondary small" disabled={isActive(regenOperation)} onClick={() => void regenerateAll(campaign)}><RefreshCw size={14}/>{isActive(regenOperation) ? "Regenerating…" : "Regenerate all text"}</button>}{state.contentCampaigns.length > 1 && <select aria-label="Open saved campaign" value={campaign?.id || ""} onChange={(event) => setCampaignId(event.target.value)}>{state.contentCampaigns.map((item) => <option value={item.id} key={item.id}>{item.name} · {formatDate(item.updatedAt)}</option>)}</select>}</div></div>
      <InlineOperation operation={regenOperation} compact/>
      {campaign && <SavedContextSummary campaign={campaign} documents={state.contextDocuments}/>}
      {campaign?.status === "failed" ? <div className="empty-state danger"><TriangleAlert/><h3>This content run failed</h3><p>{campaign.error || "Content generation did not complete."}</p><p>The run remains saved for inspection and did not overwrite an earlier successful campaign.</p></div> : campaign ? <div className="content-workspace"><div className="platform-grid">{campaign.posts.map((post) => <PostEditor key={`${post.id}-${post.version}`} post={post} onRefresh={workspace.refresh} onMessage={setMessage}/>)}</div>{campaign.imageGenerationEnabled ? <ImageComposer campaign={campaign} assets={state.brandAssets.filter((asset) => asset.active)} operation={imageOperation} onSubmit={generateImage} onRefresh={workspace.refresh} onMessage={setMessage}/> : <div className="panel compact-empty"><ImageIcon/><div><strong>Image generation disabled</strong><p>This campaign keeps its generated text and makes no image API request.</p></div></div>}</div> : <div className="empty-state"><PenLine size={28}/><h3>No campaign yet</h3><p>Select context and generate distinct drafts above. In demo mode, everything is deterministic and offline.</p></div>}
    </section>
  </div>;
}

function PostEditor({ post, onRefresh, onMessage }: { post: PlatformPost; onRefresh: () => Promise<void>; onMessage: (value: string) => void }) {
  const [text, setText] = useState(post.text); const [hook, setHook] = useState(post.hook); const [callToAction, setCallToAction] = useState(post.callToAction); const [hashtags, setHashtags] = useState(post.hashtags); const [headline, setHeadline] = useState(post.imageHeadline); const [subheadline, setSubheadline] = useState(post.imageSubheadline); const [alt, setAlt] = useState(post.imageAltText);
  const operations = useOperations();
  const [operationId, setOperationId] = useState<string | null>(null);
  const operation = operations.findOperation({ id: operationId, kind: "content_regenerate", targetPrefix: `content:regenerate:${post.campaignId}:${post.platform}` });
  const busy = Boolean(operation && ["queued", "running", "cancel_requested"].includes(operation.status));
  const config = PLATFORM_CONFIG[post.platform];
  async function save(review = false) {
    try { await apiRequest("/api/content/post", { method: "PATCH", body: JSON.stringify({ id: post.id, text, hook, callToAction, hashtags, imageHeadline: headline, imageSubheadline: subheadline, imageAltText: alt, ...(review ? { reviewStatus: "reviewed" } : {}) }) }); onMessage(review ? `${config.label} draft marked reviewed.` : `${config.label} draft saved.`); await onRefresh(); }
    catch (error) { onMessage(error instanceof Error ? error.message : "Could not save the post."); }
  }
  async function regenerate() {
    onMessage("");
    try {
      const started = await operations.startOperation("/api/content/regenerate", { method: "POST", body: JSON.stringify({ campaignId: post.campaignId, platform: post.platform }) });
      setOperationId(started.id);
    } catch (error) { onMessage(error instanceof Error ? error.message : "Regeneration could not be started."); }
  }
  return <article className={`platform-card ${busy ? "operation-active" : ""}`}><div className="platform-heading"><div><span className="platform-mark">{post.platform === "x" ? "X" : post.platform === "linkedin" ? "Li" : "Ig"}</span><div><h3>{config.label}</h3><small>Version {post.version} · {post.styleGuideStatus.replaceAll("_", " ")}</small></div></div><span className={text.length > config.characterLimit ? "count over" : "count"}>{text.length}/{config.characterLimit}</span></div>
    <label>Hook<input value={hook} onChange={(event) => setHook(event.target.value)}/></label><label>Post text<textarea rows={post.platform === "x" ? 7 : 11} value={text} onChange={(event) => setText(event.target.value)}/></label><label>Call to action<input value={callToAction} onChange={(event) => setCallToAction(event.target.value)}/></label><label>Hashtags<input value={hashtags} onChange={(event) => setHashtags(event.target.value)}/></label>
    <details><summary>Image text and alt text</summary><div className="form-stack inner"><label>Headline<input maxLength={60} value={headline} onChange={(event) => setHeadline(event.target.value)}/></label><label>Subheadline<input maxLength={96} value={subheadline} onChange={(event) => setSubheadline(event.target.value)}/></label><label>Alt text<textarea rows={3} value={alt} onChange={(event) => setAlt(event.target.value)}/></label></div></details>
    {post.warnings.length > 0 && <div className="warnings"><TriangleAlert size={15}/><ul>{post.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
    <div className="row-actions wrap"><button className="button secondary small" onClick={() => void navigator.clipboard.writeText(`${text}${hashtags ? `\n\n${hashtags}` : ""}`)}><Clipboard size={14}/>Copy</button><button className="button secondary small" onClick={() => void save()}><Save size={14}/>Save</button><button className="button secondary small" disabled={busy} onClick={() => void regenerate()}><RefreshCw size={14}/>{busy ? "Regenerating…" : "Regenerate"}</button><button className="button small" disabled={text.length > config.characterLimit} onClick={() => void save(true)}><Check size={14}/>Review</button></div>
    <InlineOperation operation={operation} compact/>
  </article>;
}

function ImageComposer({ campaign, assets, operation, onSubmit, onRefresh, onMessage }: { campaign: ContentCampaign; assets: Array<{ id: string; title: string }>; operation: AiOperation | null; onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>; onRefresh: () => Promise<void>; onMessage: (message: string) => void }) {
  const [platform, setPlatform] = useState<Platform>(campaign.posts[0]?.platform || "instagram");
  const post = campaign.posts.find((item) => item.platform === platform) || campaign.posts[0];
  const backgrounds = campaign.assets.filter((asset) => asset.kind === "background");
  const busy = Boolean(operation && ["queued", "running", "cancel_requested"].includes(operation.status));
  return <section className={`panel image-composer ${busy ? "operation-active" : ""}`}><div className="panel-heading"><div><h2>Campaign graphic</h2><p className="muted">Generated background, exact text rendered in-app</p></div></div><form className="form-stack" onSubmit={onSubmit}><input type="hidden" name="campaignId" value={campaign.id}/><label>Platform preset<select name="platform" value={platform} onChange={(event) => setPlatform(event.target.value as Platform)}>{campaign.platforms.map((item) => <option key={item} value={item}>{PLATFORM_CONFIG[item].label} · {PLATFORM_CONFIG[item].image.width}×{PLATFORM_CONFIG[item].image.height}</option>)}</select></label><label>Visual prompt<textarea name="prompt" rows={4} required defaultValue={post?.imagePrompt}/><small>The service appends a strict no-text/no-logo instruction.</small></label><label>Exact headline<input name="headline" required maxLength={60} defaultValue={post?.imageHeadline}/></label><label>Subheadline<input name="subheadline" maxLength={96} defaultValue={post?.imageSubheadline}/></label><label>Footer / call to action<input name="footer" maxLength={116} defaultValue={post?.callToAction}/></label><label>Logo<select name="logoAssetId" defaultValue={campaign.selectedBrandAssetId || ""}><option value="">No logo</option>{assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.title}</option>)}</select></label><label>Logo placement<select name="logoPlacement" defaultValue="top_right"><option value="top_right">Top right</option><option value="top_left">Top left</option><option value="bottom_right">Bottom right</option><option value="bottom_left">Bottom left</option></select></label>{backgrounds.length > 0 && <label>Background<select name="baseAssetId" defaultValue=""><option value="">Generate a new background</option>{backgrounds.map((asset) => <option value={asset.id} key={asset.id}>Reuse {formatDate(asset.createdAt)} background</option>)}</select></label>}<button className="button" disabled={busy}><ImageIcon size={17}/>{busy ? "Rendering in background" : "Generate and render graphic"}</button></form><InlineOperation operation={operation}/>
    {campaign.assets.filter((asset) => asset.kind === "composite").length > 0 && <div className="generated-gallery">{campaign.assets.filter((asset) => asset.kind === "composite").map((asset) => { const assetPost = campaign.posts.find((item) => item.platform === asset.overlay.platform); return <figure key={asset.id}><Image unoptimized loading="eager" width={asset.width} height={asset.height} src={`/api/generated?id=${asset.id}`} alt={assetPost?.imageAltText || String(asset.overlay.headline || "Generated campaign graphic")}/><figcaption><span className="asset-output-details"><span>{asset.width}×{asset.height} · {formatDate(asset.createdAt)}</span><span className="badge success">C2PA stripped</span></span><span className="row-actions"><a className="button secondary small" href={`/api/generated?id=${asset.id}&download=1`}><Download size={14}/>PNG</a><button className="icon-button danger-text" aria-label="Delete generated graphic" onClick={async () => { if (!confirm("Delete this generated graphic?")) return; try { await apiRequest(`/api/generated?id=${asset.id}`, { method: "DELETE" }); onMessage("Generated graphic deleted."); await onRefresh(); } catch (error) { onMessage(error instanceof Error ? error.message : "Could not delete the graphic."); } }}><Trash2 size={14}/></button></span></figcaption></figure>; })}</div>}
  </section>;
}

function SavedContextSummary({ campaign, documents }: { campaign: ContentCampaign; documents: Array<{ id: string; title: string; body: string; active: boolean }> }) {
  const selected = campaign.contextDocumentIds.map((id) => documents.find((document) => document.id === id));
  const activeSize = selected.reduce((sum, document) => sum + (document?.active ? document.body.length : 0), 0);
  return <details className="saved-context-summary"><summary>Context used by regeneration · {selected.filter((document) => document?.active).length} active · approximately {activeSize.toLocaleString()} characters</summary><ul>{selected.map((document, index) => <li key={campaign.contextDocumentIds[index]}>{document ? `${document.title}${document.active ? "" : " (inactive — excluded from regeneration)"}` : "Deleted context — excluded from regeneration"}</li>)}</ul></details>;
}
