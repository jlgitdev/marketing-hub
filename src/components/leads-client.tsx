"use client";

import { useState } from "react";
import { Check, Clipboard, ContactRound, Download, ExternalLink, Mail, RefreshCw, Save, Search, Trash2, TriangleAlert } from "lucide-react";
import type { LeadRecord, OutreachCampaign, OutreachRecipient } from "@/lib/types";
import { apiRequest, ConnectionBadge, PageState, formatDate, useWorkspace } from "./workspace";
import { ContextPicker } from "./context-picker";
import { InlineOperation, useOperations } from "./operations";

export function LeadsClient({ initialRunId = null, initialOutreachId = null }: { initialRunId?: string | null; initialOutreachId?: string | null }) {
  const workspace = useWorkspace();
  const operations = useOperations();
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [confidence, setConfidence] = useState("all");
  const [opportunityType, setOpportunityType] = useState("all");
  const [sort, setSort] = useState("newest");
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [outreachId, setOutreachId] = useState<string | null>(initialOutreachId);
  const [selectionOverrides, setSelectionOverrides] = useState<Record<string, boolean>>({});
  const [researchOperationId, setResearchOperationId] = useState<string | null>(null);
  const [outreachOperationId, setOutreachOperationId] = useState<string | null>(null);
  const [outreachRegenOperationId, setOutreachRegenOperationId] = useState<string | null>(null);
  const researchOperation = operations.findOperation({ id: researchOperationId, kind: "research", originPath: "/leads" });
  const outreachOperation = operations.findOperation({ id: outreachOperationId, kind: "outreach_create", originPath: "/leads" });
  const selectedOutreachRegenOperation = outreachRegenOperationId ? operations.findOperation({ id: outreachRegenOperationId }) : null;
  const isActive = (operation: typeof researchOperation) => Boolean(operation && ["queued", "running", "cancel_requested"].includes(operation.status));
  if (!workspace.state) return <PageState loading={workspace.loading} error={workspace.error} retry={workspace.refresh}/>;
  const state = workspace.state;
  const activeContext = state.contextDocuments.filter((document) => document.active);
  const visibleLeads = runId ? state.leads.filter((lead) => lead.researchRunId === runId) : state.leads;
  const isSelected = (lead: LeadRecord) => selectionOverrides[lead.id] ?? lead.selected;
  const selected = visibleLeads.filter(isSelected);
  const filtered = visibleLeads.filter((lead) => {
    const query = search.toLowerCase();
    return (!query || `${lead.organizationName} ${lead.eventName || ""} ${lead.contactEmail || ""} ${lead.recommendedAction}`.toLowerCase().includes(query)) && (confidence === "all" || lead.confidence === confidence) && (opportunityType === "all" || lead.opportunityClass === opportunityType);
  }).sort((a, b) => sort === "name" ? a.organizationName.localeCompare(b.organizationName) : sort === "confidence" ? ({ high: 0, medium: 1, low: 2 }[a.confidence] - { high: 0, medium: 1, low: 2 }[b.confidence]) : b.researchedAt.localeCompare(a.researchedAt));
  const duplicatePairs = visibleLeads.flatMap((lead, index) => visibleLeads.slice(index + 1).filter((other) => (lead.organizationDomain && lead.organizationDomain === other.organizationDomain && (lead.eventName || "") === (other.eventName || "")) || (lead.organizationName.toLowerCase() === other.organizationName.toLowerCase() && (lead.eventName || "") === (other.eventName || ""))).map((other) => [lead, other] as const));
  const latestOutreach = state.outreachCampaigns.find((campaign) => campaign.id === outreachId) || state.outreachCampaigns[0];
  const outreachRegenOperation = selectedOutreachRegenOperation || operations.findOperation({ kind: "outreach_regenerate", targetPrefix: `outreach:regenerate:${latestOutreach?.id || "no-campaign"}` });

  async function research(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null);
    const form = new FormData(event.currentTarget);
    const contextDocumentIds = form.getAll("contextDocumentIds").map(String);
    try {
      const operation = await operations.startOperation("/api/research", { method: "POST", body: JSON.stringify({
        name: form.get("name"), objective: form.get("objective"), region: form.get("region"), count: Number(form.get("count")), contextDocumentIds, contextMode: form.get("contextMode"),
        opportunityTypes: form.getAll("opportunityTypes"), organizationCategories: String(form.get("organizationCategories") || "").split(",").map((item) => item.trim()).filter(Boolean), eventCategories: String(form.get("eventCategories") || "").split(",").map((item) => item.trim()).filter(Boolean),
        targetRoles: String(form.get("targetRoles") || "").split(",").map((item) => item.trim()).filter(Boolean), audienceRoles: String(form.get("audienceRoles") || "").split(",").map((item) => item.trim()).filter(Boolean), positiveKeywords: form.get("positiveKeywords"), exclusionKeywords: form.get("exclusionKeywords"), dateRange: form.get("dateRange"), notes: form.get("notes")
      }) });
      setResearchOperationId(operation.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Research could not be started."); }
  }

  async function patchLead(id: string, patch: Record<string, unknown>) {
    const optimisticSelection = typeof patch.selected === "boolean" ? patch.selected : null;
    if (optimisticSelection !== null) setSelectionOverrides((current) => ({ ...current, [id]: optimisticSelection }));
    try { await apiRequest("/api/leads", { method: "PATCH", body: JSON.stringify({ id, ...patch }) }); await workspace.refresh(); }
    catch (error) {
      if (optimisticSelection !== null) setSelectionOverrides((current) => { const next = { ...current }; delete next[id]; return next; });
      setMessage(error instanceof Error ? error.message : "Could not update the lead.");
    }
  }

  async function saveLead(event: React.FormEvent<HTMLFormElement>, lead: LeadRecord) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await patchLead(lead.id, { contactName: form.get("contactName") || null, contactRole: form.get("contactRole") || null, contactEmail: form.get("contactEmail") || null, recommendedAction: form.get("recommendedAction"), fitExplanation: form.get("fitExplanation") });
    setMessage("Manual edits saved without removing the original source evidence.");
  }

  async function createOutreach(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const operation = await operations.startOperation("/api/outreach", { method: "POST", body: JSON.stringify({ name: form.get("name"), mode: form.get("mode"), leadIds: selected.map((lead) => lead.id), contextDocumentIds: form.getAll("contextDocumentIds"), contextMode: form.get("contextMode"), instructions: form.get("instructions") }) });
      setOutreachOperationId(operation.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Outreach generation could not be started."); }
  }

  async function regenerateAllOutreach(campaignId: string) {
    setMessage(null);
    try {
      const operation = await operations.startOperation("/api/outreach/regenerate", { method: "POST", body: JSON.stringify({ campaignId, recipientId: null }) });
      setOutreachRegenOperationId(operation.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Regeneration could not be started."); }
  }

  async function updateRecipient(recipient: OutreachRecipient, patch: Record<string, unknown>) {
    try { await apiRequest("/api/outreach/recipient", { method: "PATCH", body: JSON.stringify({ id: recipient.id, ...patch }) }); await workspace.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update the recipient."); }
  }

  async function copyEmails() {
    const emails = selected.filter((lead) => lead.verificationStatus === "source_backed").map((lead) => lead.contactEmail).filter(Boolean).join(", ");
    if (!emails) return setMessage("No selected lead has a source-backed email.");
    await navigator.clipboard.writeText(emails); setMessage("Selected source-backed addresses copied.");
  }

  async function mergeDuplicates(primaryId: string, duplicateId: string) {
    if (!confirm("Merge these two records? Sources and warnings will be preserved, and the duplicate record will be removed.")) return;
    try { await apiRequest("/api/leads", { method: "POST", body: JSON.stringify({ primaryId, duplicateId }) }); setMessage("Duplicate records merged with their evidence preserved."); await workspace.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not merge duplicates."); }
  }

  return <div className="page">
    <header className="page-header split"><div><h1>Leads</h1><p className="lede">Research organizations and upcoming events, inspect every source, then prepare outreach for human review.</p></div><ConnectionBadge state={state}/></header>
    {message && <div className={message.toLowerCase().includes("failed") || message.toLowerCase().includes("could not") ? "notice danger" : "notice"} role="status">{message}</div>}
    <section className="panel research-form"><div className="panel-heading"><h2>New research run</h2><span className="credit-note">{state.demoMode ? "No network or API use" : "Live research uses API credits"}</span></div>
      <form onSubmit={research} className="form-grid">
        <label>Run name<input name="name" required defaultValue="Bay Area AI opportunity scan"/></label>
        <label>Region<input name="region" required defaultValue="San Francisco Bay Area"/></label>
        <label className="span-two">Research objective<textarea name="objective" rows={2} required defaultValue="Find relevant organizations and upcoming events that could share or receive an invitation to our AI event."/></label>
        <label>Desired results<input name="count" type="number" min="1" max="50" defaultValue={state.demoMode ? 12 : 18}/><small>Hard maximum: 50</small></label>
        <fieldset><legend>Opportunity types</legend><div className="check-row"><label className="check"><input name="opportunityTypes" type="checkbox" value="organization" defaultChecked/>Organizations</label><label className="check"><input name="opportunityTypes" type="checkbox" value="event" defaultChecked/>Upcoming events</label></div></fieldset>
        <fieldset className="span-two"><legend>Selected context <span>Review before starting</span></legend>{activeContext.length ? <ContextPicker documents={activeContext}/> : <p className="warning-copy">Add active context before research.</p>}</fieldset>
        <details className="advanced span-two"><summary>Advanced search controls</summary><div className="form-grid inner"><label>Organization categories<input name="organizationCategories" defaultValue="education, universities, AI communities, startup communities, professional associations"/></label><label>Event categories<input name="eventCategories" defaultValue="AI events, technology events, entrepreneurship events, education events, workshops, meetups"/></label><label>Target contact roles<input name="targetRoles" defaultValue="partnerships, community, events, marketing, programs, education"/></label><label>Audience roles<input name="audienceRoles" defaultValue="builders, researchers, founders, educators, students, community leaders"/></label><label>Positive keywords<input name="positiveKeywords" defaultValue="AI, technology, research, founders, education"/></label><label>Exclusions<input name="exclusionKeywords" defaultValue="closed events, unrelated consumer offers, private directories"/></label><label>Optional event-date range<input name="dateRange" placeholder="2026-07-12 through 2026-12-31"/></label><label>Notes<input name="notes" placeholder="Prioritize official contact pages"/></label></div></details>
        <div className="span-two form-footer"><p>{activeContext.length ? `${activeContext.length} active documents selected by default.` : "Context is required."}</p><button className="button" disabled={isActive(researchOperation) || !activeContext.length}><Search size={17}/>{isActive(researchOperation) ? "Research in progress" : "Find opportunities"}</button></div>
      </form>
      <InlineOperation operation={researchOperation}/>
    </section>
    <section className="section-block"><div className="section-heading split"><div><h2>Saved opportunities</h2><p className="muted">{visibleLeads.length} results · {visibleLeads.filter((lead) => lead.reviewStatus === "unreviewed" || lead.reviewStatus === "needs_review").length} awaiting review{runId && <> · Showing saved run: {state.researchRuns.find((run) => run.id === runId)?.name || "Deleted run"}</>}</p></div><div className="toolbar"><select aria-label="Open saved research run" value={runId || "all"} onChange={(event) => setRunId(event.target.value === "all" ? null : event.target.value)}><option value="all">All saved runs</option>{state.researchRuns.map((run) => <option value={run.id} key={run.id}>{run.name}</option>)}</select><div className="search-field"><Search size={15}/><input aria-label="Search leads" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search results"/></div><select aria-label="Filter confidence" value={confidence} onChange={(event) => setConfidence(event.target.value)}><option value="all">All confidence</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select><select aria-label="Filter opportunity type" value={opportunityType} onChange={(event) => setOpportunityType(event.target.value)}><option value="all">All types</option><option value="organization">Organizations</option><option value="event">Events</option></select><select aria-label="Sort leads" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="confidence">Confidence</option><option value="name">Organization name</option></select></div></div>
      {duplicatePairs.length > 0 && <div className="duplicate-review"><TriangleAlert size={17}/><div><strong>{duplicatePairs.length} possible duplicate pair{duplicatePairs.length === 1 ? "" : "s"}</strong><p>Review carefully; records are never manually merged without confirmation.</p>{duplicatePairs.map(([primary, duplicate]) => <div className="duplicate-pair" key={`${primary.id}-${duplicate.id}`}><span>{primary.organizationName} · {formatDate(primary.researchedAt)}</span><span>{duplicate.organizationName} · {formatDate(duplicate.researchedAt)}</span><button className="button secondary small" onClick={() => void mergeDuplicates(primary.id, duplicate.id)}>Merge into first</button></div>)}</div></div>}
      {filtered.length ? <div className="lead-list">{filtered.map((lead) => <LeadCard key={lead.id} lead={{ ...lead, selected: isSelected(lead) }} onPatch={patchLead} onSave={saveLead} onDelete={async () => { if (confirm(`Delete ${lead.organizationName}?`)) { await apiRequest(`/api/leads?id=${lead.id}`, { method: "DELETE" }); await workspace.refresh(); }}}/>)}</div> : <div className="empty-state"><ContactRound/><h3>{visibleLeads.length ? "No results match these filters" : "No opportunities yet"}</h3><p>{visibleLeads.length ? "Clear a filter to see saved leads." : "Start a bounded demo or live research run above."}</p></div>}
    </section>
    <section className="panel section-block outreach-panel"><div className="panel-heading"><div><h2>Outreach preparation</h2><p className="muted">{selected.length} selected lead{selected.length === 1 ? "" : "s"}</p></div><button className="button secondary small" type="button" onClick={() => void copyEmails()}><Clipboard size={15}/>Copy addresses</button></div>
      <form className="form-grid" onSubmit={createOutreach}><label>Campaign name<input name="name" required defaultValue="Bay Area opportunity outreach"/></label><label>Mode<select name="mode" defaultValue="partner_share"><option value="partner_share">Partner-share request</option><option value="direct_invitation">Direct invitation</option></select></label><label className="span-two">Campaign instruction<input name="instructions" placeholder="Keep the request concise and offer a reusable announcement."/></label><fieldset className="span-two"><legend>Context for event facts and voice</legend><ContextPicker documents={activeContext}/></fieldset><div className="span-two form-footer"><p>No email is sent. Drafts remain local until exported.</p><button className="button" disabled={!selected.length || isActive(outreachOperation)}><Mail size={17}/>{isActive(outreachOperation) ? "Drafting in background" : "Create outreach campaign"}</button></div></form>
      <InlineOperation operation={outreachOperation}/>
      {latestOutreach && <div className="campaign-preview"><div className="section-heading"><div><span className="type-label">Saved outreach campaign</span><h3>{latestOutreach.name}</h3><small>{latestOutreach.previewText || latestOutreach.callToAction}</small></div><div className="row-actions wrap">{state.outreachCampaigns.length > 1 && <select aria-label="Open saved outreach campaign" value={latestOutreach.id} onChange={(event) => setOutreachId(event.target.value)}>{state.outreachCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} · {formatDate(campaign.updatedAt)}</option>)}</select>}<button className="button secondary small" onClick={async () => { const approved = latestOutreach.recipients.filter((recipient) => recipient.reviewStatus === "reviewed" && !recipient.excluded && recipient.email).map((recipient) => recipient.email).join(", "); if (!approved) return setMessage("No reviewed recipient addresses are ready to copy."); await navigator.clipboard.writeText(approved); setMessage("All reviewed recipient addresses copied."); }}><Clipboard size={14}/>Copy approved addresses</button><button className="button secondary small" disabled={isActive(outreachRegenOperation)} onClick={() => void regenerateAllOutreach(latestOutreach.id)}><RefreshCw size={14}/>{isActive(outreachRegenOperation) ? "Regenerating…" : "Regenerate all"}</button><a className="button secondary small" href={`/api/export?campaignId=${latestOutreach.id}`}><Download size={15}/>Export reviewed CSV</a></div></div><InlineOperation operation={outreachRegenOperation} compact/><details className="saved-context-summary"><summary>Context used by outreach regeneration · {latestOutreach.contextDocumentIds.filter((id) => state.contextDocuments.some((document) => document.id === id && document.active)).length} active documents</summary><ul>{latestOutreach.contextDocumentIds.map((id) => { const document = state.contextDocuments.find((item) => item.id === id); return <li key={id}>{document ? `${document.title}${document.active ? "" : " (inactive — excluded from regeneration)"}` : "Deleted context — excluded from regeneration"}</li>; })}</ul></details><MasterOutreachEditor campaign={latestOutreach} onRefresh={workspace.refresh} onMessage={setMessage}/><div className="recipient-list">{latestOutreach.recipients.map((recipient) => <RecipientEditor key={recipient.id} recipient={recipient} campaign={latestOutreach} lead={state.leads.find((lead) => lead.id === recipient.leadId)} onUpdate={updateRecipient} onRefresh={workspace.refresh} onMessage={setMessage}/>)}</div></div>}
    </section>
  </div>;
}

function LeadCard({ lead, onPatch, onSave, onDelete }: { lead: LeadRecord; onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>; onSave: (event: React.FormEvent<HTMLFormElement>, lead: LeadRecord) => Promise<void>; onDelete: () => Promise<void> }) {
  return <article className={`lead-card ${lead.selected ? "selected" : ""}`}>
    <div className="lead-select"><input type="checkbox" aria-label={`Select ${lead.organizationName}`} checked={lead.selected} onChange={(event) => void onPatch(lead.id, { selected: event.target.checked })}/></div>
    <div className="lead-main"><div className="lead-title"><div><div className="inline-labels"><span className="type-label">{lead.opportunityClass}</span><span className={`badge confidence-${lead.confidence}`}>{lead.confidence} confidence</span><span className={`badge ${lead.verificationStatus === "source_backed" ? "success" : lead.verificationStatus === "requires_review" ? "warning" : ""}`}>{lead.verificationStatus.replaceAll("_", " ")}</span>{Object.keys(lead.userEdits).length > 0 && <span className="badge">User edited</span>}</div><h3>{lead.eventName || lead.organizationName}</h3>{lead.eventName && <p>Organized by {lead.eventOrganizer || lead.organizationName}</p>}<small>{[lead.organizationType, lead.city, lead.region].filter(Boolean).join(" · ")}{lead.eventStartDate ? ` · ${formatDate(lead.eventStartDate)}` : ""}</small></div><button className="icon-button danger-text" onClick={() => void onDelete()} aria-label={`Delete ${lead.organizationName}`}><Trash2 size={16}/></button></div>
      <div className="lead-grid"><div><span>Recommended action</span><p>{lead.recommendedAction}</p></div><div><span>Contact</span><p>{lead.contactEmail ? <><strong>{lead.contactEmail}</strong><small>{lead.contactRole || lead.emailCategory.replaceAll("_", " ")}</small></> : lead.contactPageUrl ? <a href={lead.contactPageUrl} target="_blank" rel="noopener noreferrer">Contact page only <ExternalLink size={13}/></a> : "No public contact method"}</p></div><div className="fit"><span>Why it fits</span><p>{lead.fitExplanation}</p></div></div>
      {lead.warnings.length > 0 && <div className="warnings"><TriangleAlert size={15}/><ul>{lead.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
      <details className="evidence"><summary>Inspect {lead.sources.length} supporting source{lead.sources.length === 1 ? "" : "s"} and edit</summary><div className="evidence-summary"><strong>Evidence summary</strong><p>{lead.evidenceSummary}</p><small>Researched {formatDate(lead.researchedAt)}</small></div><div className="source-list">{lead.sources.map((source) => <a key={source.id || source.url} href={source.url} target="_blank" rel="noopener noreferrer"><span><strong>{source.title}</strong><small>{source.claim}</small></span><ExternalLink size={15}/></a>)}</div><form className="form-grid inner edit-lead" onSubmit={(event) => void onSave(event, lead)}><label>Contact name<input name="contactName" defaultValue={lead.contactName || ""}/></label><label>Contact role<input name="contactRole" defaultValue={lead.contactRole || ""}/></label><label>Email<input name="contactEmail" type="email" defaultValue={lead.contactEmail || ""}/><small>User edits are labeled and do not become source-backed.</small></label><label className="span-two">Recommended action<textarea name="recommendedAction" rows={2} defaultValue={lead.recommendedAction}/></label><label className="span-two">Fit explanation<textarea name="fitExplanation" rows={2} defaultValue={lead.fitExplanation}/></label><button className="button secondary small">Save manual edits</button></form></details>
    </div>
    <div className="lead-review"><select aria-label={`Review status for ${lead.organizationName}`} value={lead.reviewStatus} onChange={(event) => void onPatch(lead.id, { reviewStatus: event.target.value })}><option value="unreviewed">Unreviewed</option><option value="reviewed">Reviewed</option><option value="needs_review">Needs review</option><option value="rejected">Rejected</option></select></div>
  </article>;
}

function MasterOutreachEditor({ campaign, onRefresh, onMessage }: { campaign: OutreachCampaign; onRefresh: () => Promise<void>; onMessage: (value: string) => void }) {
  const [subject, setSubject] = useState(campaign.subjectTemplate); const [body, setBody] = useState(campaign.bodyTemplate); const [callToAction, setCallToAction] = useState(campaign.callToAction); const [previewText, setPreviewText] = useState(campaign.previewText); const [announcement, setAnnouncement] = useState(campaign.forwardableAnnouncement);
  return <details className="master-editor"><summary>Edit master template and forwardable announcement</summary><div className="form-stack inner">{campaign.warnings.length > 0 && <div className="warnings"><TriangleAlert size={15}/><div><strong>Missing-context warnings</strong><ul>{campaign.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>{campaign.status !== "reviewed" ? <button className="button secondary small" onClick={async () => { await apiRequest("/api/outreach", { method: "PATCH", body: JSON.stringify({ id: campaign.id, status: "reviewed" }) }); onMessage("Missing-context warnings explicitly acknowledged. Resolve placeholders before export."); await onRefresh(); }}>Acknowledge warnings</button> : <span className="badge warning">Acknowledged</span>}</div></div>}<label>Subject template<input value={subject} onChange={(event) => setSubject(event.target.value)}/></label><label>Preview text<input value={previewText} onChange={(event) => setPreviewText(event.target.value)}/></label><label>Call to action<input value={callToAction} onChange={(event) => setCallToAction(event.target.value)}/></label><label>Master message<textarea rows={9} value={body} onChange={(event) => setBody(event.target.value)}/></label><label>Forwardable announcement<textarea rows={4} value={announcement} onChange={(event) => setAnnouncement(event.target.value)}/></label><button className="button secondary small" onClick={async () => { try { await apiRequest("/api/outreach", { method: "PATCH", body: JSON.stringify({ id: campaign.id, subjectTemplate: subject, bodyTemplate: body, callToAction, previewText, forwardableAnnouncement: announcement }) }); onMessage("Master outreach template saved."); await onRefresh(); } catch (error) { onMessage(error instanceof Error ? error.message : "Could not save the master template."); } }}><Save size={14}/>Save master template</button></div></details>;
}

function RecipientEditor({ recipient, campaign, lead, onUpdate, onRefresh, onMessage }: { recipient: OutreachRecipient; campaign: OutreachCampaign; lead?: LeadRecord; onUpdate: (recipient: OutreachRecipient, patch: Record<string, unknown>) => Promise<void>; onRefresh: () => Promise<void>; onMessage: (value: string) => void }) {
  const [subject, setSubject] = useState(recipient.subject); const [body, setBody] = useState(recipient.body);
  void onRefresh;
  const operations = useOperations();
  const [operationId, setOperationId] = useState<string | null>(null);
  const operation = operations.findOperation({ id: operationId, kind: "outreach_regenerate", targetPrefix: `outreach:regenerate:${recipient.id}` });
  const active = Boolean(operation && ["queued", "running", "cancel_requested"].includes(operation.status));
  const values: Record<string, string> = { organization_name: lead?.organizationName || "{{organization_name}}", contact_name: lead?.contactName || "{{contact_name}}", contact_first_name: lead?.contactName?.split(" ")[0] || "{{contact_first_name}}", contact_role: lead?.contactRole || "{{contact_role}}", event_name: lead?.eventName || "{{event_name}}", event_date: lead?.eventStartDate || "{{event_date}}", event_location: [lead?.city, lead?.region].filter(Boolean).join(", ") || "{{event_location}}" };
  const substitute = (value: string) => value.replace(/{{([a-z_]+)}}/g, (match, field) => values[field] || match);
  return <details className="recipient-card"><summary><span><strong>{lead?.organizationName || "Recipient"}</strong><small>{recipient.email || "No source-backed email"}</small></span><span className={`badge ${recipient.reviewStatus === "reviewed" ? "success" : ""}`}>{recipient.excluded ? "excluded" : recipient.reviewStatus.replaceAll("_", " ")}</span></summary><div className="recipient-editor"><label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)}/></label><label>Message body<textarea rows={10} value={body} onChange={(event) => setBody(event.target.value)}/></label>{lead?.sources.length ? <details className="personalization-sources"><summary>Source-backed personalization evidence</summary><div className="source-list">{lead.sources.map((source) => <a key={source.id || source.url} href={source.url} target="_blank" rel="noopener noreferrer"><span><strong>{source.title}</strong><small>{source.claim}</small></span><ExternalLink size={14}/></a>)}</div></details> : null}{recipient.warnings.length > 0 && <div className="warnings"><TriangleAlert size={15}/><ul>{recipient.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}<label className="check"><input type="checkbox" checked={recipient.excluded} onChange={(event) => void onUpdate(recipient, { excluded: event.target.checked })}/>Exclude from export</label><div className="row-actions wrap"><button className="button secondary small" onClick={() => void navigator.clipboard.writeText(subject)}><Clipboard size={14}/>Copy subject</button><button className="button secondary small" onClick={() => void navigator.clipboard.writeText(body)}><Clipboard size={14}/>Copy body</button><button className="button secondary small" onClick={() => void onUpdate(recipient, { subject, body })}>Save edits</button><button className="button secondary small" onClick={() => { setSubject(substitute(campaign.subjectTemplate)); setBody(substitute(campaign.bodyTemplate)); onMessage("Recipient reset to the current master template. Save to keep the change."); }}>Reset to master</button><button className="button secondary small" disabled={active} onClick={async () => { try { const started = await operations.startOperation("/api/outreach/regenerate", { method: "POST", body: JSON.stringify({ campaignId: campaign.id, recipientId: recipient.id }) }); setOperationId(started.id); } catch (error) { onMessage(error instanceof Error ? error.message : "Recipient regeneration could not be started."); } }}><RefreshCw size={14}/>{active ? "Regenerating…" : "Regenerate"}</button><button className="button small" disabled={!recipient.email || recipient.excluded || (campaign.warnings.length > 0 && campaign.status !== "reviewed") || recipient.warnings.some((warning) => /requires review/.test(warning) || (/Unresolved placeholders/.test(warning) && campaign.status !== "reviewed"))} onClick={() => void onUpdate(recipient, { subject, body, reviewStatus: "reviewed" })}><Check size={14}/>Mark reviewed</button></div><InlineOperation operation={operation} compact/></div></details>;
}
