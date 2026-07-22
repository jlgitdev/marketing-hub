"use client";

import { useState } from "react";
import { ArrowRight, Check, Clipboard, ContactRound, Download, ExternalLink, ListFilter, Mail, RefreshCw, Save, Search, Sparkles, Target, Trash2, TriangleAlert, UsersRound, X } from "lucide-react";
import type { LeadRecord, LeadSalesMotion, LeadTargetSegment, OutreachCampaign, OutreachRecipient } from "@/lib/types";
import { apiRequest, cleanDisplayText, ConnectionBadge, PageState, formatDate, useWorkspace } from "./workspace";
import { ContextPicker } from "./context-picker";
import { InlineOperation, useOperations } from "./operations";

const SEGMENT_OPTIONS: Array<{ value: LeadTargetSegment; label: string }> = [
  { value: "ai_professionals", label: "AI professionals" },
  { value: "technology_employees", label: "Tech employees" },
  { value: "founders_operators", label: "Founders" },
  { value: "researchers_academics", label: "Researchers" },
  { value: "college_students", label: "College students" },
  { value: "college_prep_education", label: "College-prep & STEM" },
  { value: "educators", label: "Educators" },
  { value: "community_leaders", label: "Community leaders" },
  { value: "investors_executives", label: "Investors & executives" }
];

const SALES_MOTION_OPTIONS: Array<{ value: LeadSalesMotion; label: string }> = [
  { value: "direct_ticket_sales", label: "Direct tickets" },
  { value: "group_ticket_sales", label: "Group tickets" },
  { value: "employer_learning_budget", label: "Employer learning budgets" },
  { value: "education_distribution", label: "Education distribution" },
  { value: "partner_distribution", label: "Audience partners" },
  { value: "cross_promotion", label: "Cross-promotion" },
  { value: "sponsorship", label: "Sponsorship" }
];

const DEFAULT_SALES_MOTIONS = SALES_MOTION_OPTIONS.filter((option) => option.value !== "sponsorship").map((option) => option.value);
type ResearchPreset = "balanced" | "buyers" | "partners";
type QueueView = "all" | "sales_ready" | "actionable" | "email" | "needs_review" | "selected";

export function LeadsClient({ initialRunId = null, initialOutreachId = null }: { initialRunId?: string | null; initialOutreachId?: string | null }) {
  const workspace = useWorkspace();
  const operations = useOperations();
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [confidence, setConfidence] = useState("all");
  const [opportunityType, setOpportunityType] = useState("all");
  const [priorityTier, setPriorityTier] = useState("all");
  const [targetSegment, setTargetSegment] = useState("all");
  const [salesMotion, setSalesMotion] = useState("all");
  const [reviewStatus, setReviewStatus] = useState("all");
  const [contactability, setContactability] = useState("all");
  const [sort, setSort] = useState("priority");
  const [queueView, setQueueView] = useState<QueueView>("all");
  const [researchPreset, setResearchPreset] = useState<ResearchPreset>("balanced");
  const [researchExpanded, setResearchExpanded] = useState<boolean | null>(null);
  const [selectedTargetSegments, setSelectedTargetSegments] = useState<LeadTargetSegment[]>(SEGMENT_OPTIONS.map((option) => option.value));
  const [selectedSalesMotions, setSelectedSalesMotions] = useState<LeadSalesMotion[]>(DEFAULT_SALES_MOTIONS);
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
    const searchable = `${lead.organizationName} ${lead.eventName || ""} ${lead.contactName || ""} ${lead.contactRole || ""} ${lead.contactEmail || ""} ${lead.city} ${lead.targetSegment} ${lead.salesMotion} ${lead.recommendedAction} ${lead.fitExplanation} ${lead.outreachAngle}`.toLowerCase();
    const contactMatch = contactability === "all" || (contactability === "email" && Boolean(lead.contactEmail) && lead.verificationStatus === "source_backed") || (contactability === "contact_page" && !lead.contactEmail && Boolean(lead.contactPageUrl)) || (contactability === "none" && !lead.contactEmail && !lead.contactPageUrl);
    const queueMatch = queueView === "all"
      || (queueView === "sales_ready" && lead.priorityScore >= 65 && Boolean(lead.contactEmail || lead.contactPageUrl) && lead.reviewStatus !== "rejected")
      || (queueView === "actionable" && Boolean(lead.contactEmail || lead.contactPageUrl) && lead.reviewStatus !== "rejected")
      || (queueView === "email" && Boolean(lead.contactEmail) && lead.verificationStatus === "source_backed")
      || (queueView === "needs_review" && (lead.reviewStatus === "unreviewed" || lead.reviewStatus === "needs_review"))
      || (queueView === "selected" && isSelected(lead));
    return queueMatch && (!query || searchable.includes(query)) && (confidence === "all" || lead.confidence === confidence) && (opportunityType === "all" || lead.opportunityClass === opportunityType) && (priorityTier === "all" || lead.priorityTier === priorityTier) && (targetSegment === "all" || lead.targetSegment === targetSegment) && (salesMotion === "all" || lead.salesMotion === salesMotion) && (reviewStatus === "all" || lead.reviewStatus === reviewStatus) && contactMatch;
  }).sort((a, b) => sort === "name" ? a.organizationName.localeCompare(b.organizationName) : sort === "confidence" ? ({ high: 0, medium: 1, low: 2 }[a.confidence] - { high: 0, medium: 1, low: 2 }[b.confidence]) : sort === "newest" ? b.researchedAt.localeCompare(a.researchedAt) : b.priorityScore - a.priorityScore);
  const salesReady = visibleLeads.filter((lead) => lead.priorityScore >= 65 && (lead.contactEmail || lead.contactPageUrl) && lead.reviewStatus !== "rejected");
  const actionable = visibleLeads.filter((lead) => Boolean(lead.contactEmail || lead.contactPageUrl) && lead.reviewStatus !== "rejected");
  const sourceBackedEmails = visibleLeads.filter((lead) => lead.verificationStatus === "source_backed" && lead.contactEmail);
  const awaitingReview = visibleLeads.filter((lead) => lead.reviewStatus === "unreviewed" || lead.reviewStatus === "needs_review");
  const activeFilterCount = [priorityTier, targetSegment, salesMotion, contactability, reviewStatus, confidence, opportunityType].filter((value) => value !== "all").length;
  const duplicatePairs = visibleLeads.flatMap((lead, index) => visibleLeads.slice(index + 1).filter((other) => Boolean(lead.canonicalKey) && lead.canonicalKey === other.canonicalKey).map((other) => [lead, other] as const));
  const latestOutreach = state.outreachCampaigns.find((campaign) => campaign.id === outreachId) || state.outreachCampaigns[0];
  const outreachRegenOperation = selectedOutreachRegenOperation || operations.findOperation({ kind: "outreach_regenerate", targetPrefix: `outreach:regenerate:${latestOutreach?.id || "no-campaign"}` });

  function applyResearchPreset(preset: ResearchPreset) {
    setResearchPreset(preset);
    if (preset === "buyers") {
      setSelectedTargetSegments(["ai_professionals", "technology_employees", "founders_operators", "researchers_academics", "investors_executives"]);
      setSelectedSalesMotions(["direct_ticket_sales", "group_ticket_sales", "employer_learning_budget"]);
    } else if (preset === "partners") {
      setSelectedTargetSegments(["college_students", "college_prep_education", "educators", "community_leaders", "founders_operators"]);
      setSelectedSalesMotions(["education_distribution", "partner_distribution", "cross_promotion"]);
    } else {
      setSelectedTargetSegments(SEGMENT_OPTIONS.map((option) => option.value));
      setSelectedSalesMotions(DEFAULT_SALES_MOTIONS);
    }
  }

  function clearFilters() {
    setSearch(""); setPriorityTier("all"); setTargetSegment("all"); setSalesMotion("all"); setContactability("all");
    setReviewStatus("all"); setConfidence("all"); setOpportunityType("all"); setQueueView("all"); setSort("priority");
  }

  async function research(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null);
    const form = new FormData(event.currentTarget);
    const contextDocumentIds = form.getAll("contextDocumentIds").map(String);
    try {
      const operation = await operations.startOperation("/api/research", { method: "POST", body: JSON.stringify({
        name: form.get("name"), objective: form.get("objective"), region: form.get("region"), count: Number(form.get("count")), contextDocumentIds, contextMode: form.get("contextMode"),
        opportunityTypes: form.getAll("opportunityTypes"), organizationCategories: String(form.get("organizationCategories") || "").split(",").map((item) => item.trim()).filter(Boolean), eventCategories: String(form.get("eventCategories") || "").split(",").map((item) => item.trim()).filter(Boolean),
        targetRoles: String(form.get("targetRoles") || "").split(",").map((item) => item.trim()).filter(Boolean), audienceRoles: String(form.get("audienceRoles") || "").split(",").map((item) => item.trim()).filter(Boolean),
        targetSegments: form.getAll("targetSegments"), salesMotions: form.getAll("salesMotions"), minimumPriorityScore: Number(form.get("minimumPriorityScore")), excludePreviouslyResearched: form.get("excludePreviouslyResearched") === "on",
        positiveKeywords: form.get("positiveKeywords"), exclusionKeywords: form.get("exclusionKeywords"), dateRange: form.get("dateRange"), notes: form.get("notes")
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
    await patchLead(lead.id, { contactName: form.get("contactName") || null, contactRole: form.get("contactRole") || null, contactEmail: form.get("contactEmail") || null, recommendedAction: form.get("recommendedAction"), fitExplanation: form.get("fitExplanation"), rejectionReason: form.get("rejectionReason") || null });
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

  async function selectSalesReady() {
    const ready = filtered.filter((lead) => lead.priorityScore >= 65 && Boolean(lead.contactEmail || lead.contactPageUrl) && lead.reviewStatus !== "rejected");
    if (!ready.length) return setMessage("No visible strong or hot lead has a usable contact path.");
    setSelectionOverrides((current) => ({ ...current, ...Object.fromEntries(ready.map((lead) => [lead.id, true])) }));
    try {
      await Promise.all(ready.map((lead) => apiRequest("/api/leads", { method: "PATCH", body: JSON.stringify({ id: lead.id, selected: true }) })));
      await workspace.refresh();
      setMessage(`${ready.length} sales-ready lead${ready.length === 1 ? "" : "s"} selected for outreach.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not select the sales-ready leads."); }
  }

  async function clearSelection() {
    if (!selected.length) return;
    setSelectionOverrides((current) => ({ ...current, ...Object.fromEntries(selected.map((lead) => [lead.id, false])) }));
    try {
      await Promise.all(selected.map((lead) => apiRequest("/api/leads", { method: "PATCH", body: JSON.stringify({ id: lead.id, selected: false }) })));
      await workspace.refresh();
      setMessage("Selection cleared.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not clear the selection."); }
  }

  async function mergeDuplicates(primaryId: string, duplicateId: string) {
    if (!confirm("Merge these two records? Sources and warnings will be preserved, and the duplicate record will be removed.")) return;
    try { await apiRequest("/api/leads", { method: "POST", body: JSON.stringify({ primaryId, duplicateId }) }); setMessage("Duplicate records merged with their evidence preserved."); await workspace.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not merge duplicates."); }
  }

  return <div className="page leads-page">
    <header className="page-header split"><div><span className="eyebrow">Lead workspace</span><h1>Find, qualify, and act on the right leads</h1><p className="lede">Build a focused search, review the strongest opportunities first, and move selected leads into source-backed outreach.</p></div><ConnectionBadge state={state}/></header>
    {message && <div className={message.toLowerCase().includes("failed") || message.toLowerCase().includes("could not") ? "notice danger" : "notice"} role="status">{message}</div>}

    <details className="panel research-launcher" open={researchExpanded ?? !visibleLeads.length} onToggle={(event) => setResearchExpanded(event.currentTarget.open)}>
      <summary><span className="workflow-step"><span>1</span><Target size={18}/></span><span className="research-launcher-copy"><strong>Find new leads</strong><small>Choose a strategy, describe the outcome, then refine only if you need to.</small></span><span className="research-launcher-meta">{state.demoMode ? "Demo research" : "Live research"}<ArrowRight size={15}/></span></summary>
      <div className="research-launcher-body">
        <form onSubmit={research} className="form-grid">
          <div className="span-two strategy-picker" role="group" aria-label="Lead search strategy">
            <div className="field-intro"><strong>Start with a strategy</strong><small>This sets the audience and sales paths. You can fine-tune them below.</small></div>
            <div className="strategy-grid">
              <button type="button" className="strategy-card" aria-pressed={researchPreset === "balanced"} onClick={() => applyResearchPreset("balanced")}><Sparkles size={17}/><span><strong>Balanced pipeline</strong><small>Ticket buyers and distribution partners</small></span><Check size={15}/></button>
              <button type="button" className="strategy-card" aria-pressed={researchPreset === "buyers"} onClick={() => applyResearchPreset("buyers")}><Target size={17}/><span><strong>Ticket buyers</strong><small>Individuals, teams, and learning budgets</small></span><Check size={15}/></button>
              <button type="button" className="strategy-card" aria-pressed={researchPreset === "partners"} onClick={() => applyResearchPreset("partners")}><UsersRound size={17}/><span><strong>Audience partners</strong><small>Communities, educators, and promoters</small></span><Check size={15}/></button>
            </div>
          </div>
          <label className="span-two">What outcome do you want?<textarea name="objective" rows={2} required defaultValue="Find people and organizations likely to buy AI summit tickets, fund team attendance, or distribute a compelling invitation to qualified local audiences."/><small>Describe the commercial outcome; the system handles discovery and verification.</small></label>
          <label>Where should we search?<input name="region" required defaultValue="San Francisco Bay Area"/></label>
          <label>How many qualified leads?<input name="count" type="number" min="1" max="50" defaultValue={state.demoMode ? 4 : 18}/><small>Maximum 50 after qualification and deduplication.</small></label>
          <fieldset className="span-two compact-fieldset"><legend>Opportunity types</legend><div className="check-row"><label className="check"><input name="opportunityTypes" type="checkbox" value="organization" defaultChecked/>Organizations</label><label className="check"><input name="opportunityTypes" type="checkbox" value="event" defaultChecked/>Upcoming events</label></div></fieldset>

          <details className="advanced span-two audience-refinement"><summary>Refine audience and sales paths <span>{selectedTargetSegments.length} audiences · {selectedSalesMotions.length} paths</span></summary><div className="form-grid inner"><fieldset className="span-two"><legend>Customer segments</legend><div className="check-row wrap">{SEGMENT_OPTIONS.map((option) => <label className="check" key={option.value}><input name="targetSegments" type="checkbox" value={option.value} checked={selectedTargetSegments.includes(option.value)} onChange={(event) => setSelectedTargetSegments((current) => event.target.checked ? [...current, option.value] : current.filter((value) => value !== option.value))}/>{option.label}</label>)}</div></fieldset><fieldset className="span-two"><legend>Sales paths</legend><div className="check-row wrap">{SALES_MOTION_OPTIONS.map((option) => <label className="check" key={option.value}><input name="salesMotions" type="checkbox" value={option.value} checked={selectedSalesMotions.includes(option.value)} onChange={(event) => setSelectedSalesMotions((current) => event.target.checked ? [...current, option.value] : current.filter((value) => value !== option.value))}/>{option.label}</label>)}</div></fieldset></div></details>
          <details className="advanced span-two"><summary>Context used for this search <span>{activeContext.length} active documents</span></summary><div className="inner">{activeContext.length ? <ContextPicker documents={activeContext}/> : <p className="warning-copy">Add active context before research.</p>}</div></details>
          <details className="advanced span-two"><summary>Advanced qualification and search controls</summary><div className="form-grid inner"><label>Run name<input name="name" required defaultValue="Bay Area AI summit sales pipeline"/></label><label>Minimum sales score<input name="minimumPriorityScore" type="number" min="0" max="100" defaultValue="45"/><small>45 keeps promising leads; 65 is a tighter list.</small></label><label>Organization categories<input name="organizationCategories" defaultValue="technology employers, college-prep organizations, universities, community colleges, AI communities, startup communities, accelerators, professional associations, coworking spaces, STEM education programs"/></label><label>Event categories<input name="eventCategories" defaultValue="AI events, technology events, entrepreneurship events, education events, workshops, meetups, hackathons, demo nights"/></label><label>Target contact roles<input name="targetRoles" defaultValue="learning and development, engineering leadership, partnerships, community, events, marketing, programs, education, student activities"/></label><label>Audience roles<input name="audienceRoles" defaultValue="AI professionals, software engineers, product leaders, founders, researchers, educators, advanced students, community leaders, executives"/></label><label>Positive keywords<input name="positiveKeywords" defaultValue="AI, machine learning, technology, professional development, STEM, founders, research, innovation"/></label><label>Exclusions<input name="exclusionKeywords" defaultValue="closed events, inactive organizations, unrelated consumer offers, private directories, generic vendors without a relevant audience"/></label><label>Event-date range<input name="dateRange" placeholder="2026-07-15 through 2026-12-31"/></label><label>Notes<input name="notes" placeholder="Prioritize employers and education partners that can move multiple tickets"/></label><label className="check span-two"><input name="excludePreviouslyResearched" type="checkbox" defaultChecked/>Exclude prospects already saved in prior runs</label></div></details>
          <div className="span-two form-footer research-submit"><p><strong>{researchPreset === "buyers" ? "Ticket buyers" : researchPreset === "partners" ? "Audience partners" : "Balanced pipeline"}</strong> · {selectedTargetSegments.length} audiences · {selectedSalesMotions.length} sales paths · {activeContext.length} context documents</p><button className="button" disabled={isActive(researchOperation) || !activeContext.length || !selectedTargetSegments.length || !selectedSalesMotions.length}><Search size={17}/>{isActive(researchOperation) ? "Research in progress" : "Find qualified leads"}</button></div>
        </form>
        <InlineOperation operation={researchOperation}/>
      </div>
    </details>

    <section className="metric-grid lead-metrics" aria-label="Sales pipeline summary">
      <button type="button" className={`metric lead-metric ${queueView === "all" ? "active" : ""}`} aria-pressed={queueView === "all"} onClick={() => setQueueView("all")}><span className="metric-symbol" aria-hidden="true"><UsersRound size={18}/></span><strong>{visibleLeads.length}</strong><small>all leads</small></button>
      <button type="button" className={`metric lead-metric ${queueView === "sales_ready" ? "active" : ""}`} aria-pressed={queueView === "sales_ready"} onClick={() => setQueueView("sales_ready")}><span className="metric-symbol" aria-hidden="true"><Target size={18}/></span><strong>{salesReady.length}</strong><small>sales-ready</small></button>
      <button type="button" className={`metric lead-metric ${queueView === "email" ? "active" : ""}`} aria-pressed={queueView === "email"} onClick={() => setQueueView("email")}><span className="metric-symbol" aria-hidden="true"><Mail size={18}/></span><strong>{sourceBackedEmails.length}</strong><small>verified emails</small></button>
      <button type="button" className={`metric lead-metric ${queueView === "needs_review" ? "active" : ""}`} aria-pressed={queueView === "needs_review"} onClick={() => setQueueView("needs_review")}><span className="metric-symbol" aria-hidden="true"><Check size={18}/></span><strong>{awaitingReview.length}</strong><small>need review</small></button>
    </section>

    <section className="section-block lead-queue"><div className="section-heading split"><div><span className="eyebrow">Step 2 · Qualify</span><h2>Prioritized lead queue</h2><p className="muted">{filtered.length} shown of {visibleLeads.length}{runId && <> · {state.researchRuns.find((run) => run.id === runId)?.name || "Deleted run"}</>}</p></div><button className="button secondary small" type="button" onClick={() => void selectSalesReady()}><Check size={14}/>Select sales-ready</button></div>
      <div className="queue-controls">
        <div className="search-field queue-search"><Search size={15}/><input aria-label="Search leads" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search names, roles, locations, or actions"/>{search && <button type="button" className="clear-search" aria-label="Clear lead search" onClick={() => setSearch("")}><X size={14}/></button>}</div>
        <select aria-label="Open saved research run" value={runId || "all"} onChange={(event) => setRunId(event.target.value === "all" ? null : event.target.value)}><option value="all">All research runs</option>{state.researchRuns.map((run) => <option value={run.id} key={run.id}>{run.name}</option>)}</select>
        <select aria-label="Sort leads" value={sort} onChange={(event) => setSort(event.target.value)}><option value="priority">Highest priority</option><option value="newest">Newest first</option><option value="confidence">Best evidence</option><option value="name">Organization A–Z</option></select>
        <details className="filter-popover"><summary><ListFilter size={15}/>More filters{activeFilterCount > 0 && <span>{activeFilterCount}</span>}</summary><div className="filter-grid"><label>Priority<select aria-label="Filter priority" value={priorityTier} onChange={(event) => setPriorityTier(event.target.value)}><option value="all">All priority tiers</option><option value="hot">Hot</option><option value="strong">Strong</option><option value="promising">Promising</option><option value="nurture">Nurture</option></select></label><label>Customer segment<select aria-label="Filter customer segment" value={targetSegment} onChange={(event) => setTargetSegment(event.target.value)}><option value="all">All customer segments</option>{SEGMENT_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>Sales path<select aria-label="Filter sales path" value={salesMotion} onChange={(event) => setSalesMotion(event.target.value)}><option value="all">All sales paths</option>{SALES_MOTION_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>Contact path<select aria-label="Filter contactability" value={contactability} onChange={(event) => setContactability(event.target.value)}><option value="all">All contact paths</option><option value="email">Source-backed email</option><option value="contact_page">Contact page</option><option value="none">No contact path</option></select></label><label>Review state<select aria-label="Filter review status" value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)}><option value="all">All review states</option><option value="unreviewed">Unreviewed</option><option value="needs_review">Needs review</option><option value="reviewed">Reviewed</option><option value="rejected">Rejected</option></select></label><label>Evidence confidence<select aria-label="Filter confidence" value={confidence} onChange={(event) => setConfidence(event.target.value)}><option value="all">All evidence confidence</option><option value="high">High evidence</option><option value="medium">Medium evidence</option><option value="low">Low evidence</option></select></label><label>Opportunity type<select aria-label="Filter opportunity type" value={opportunityType} onChange={(event) => setOpportunityType(event.target.value)}><option value="all">All types</option><option value="organization">Organizations</option><option value="event">Events</option></select></label><button type="button" className="button secondary small" onClick={clearFilters}>Reset filters</button></div></details>
      </div>
      <nav className="queue-views" aria-label="Lead queue views"><button type="button" aria-pressed={queueView === "all"} onClick={() => setQueueView("all")}>All</button><button type="button" aria-pressed={queueView === "actionable"} onClick={() => setQueueView("actionable")}>Contactable <span>{actionable.length}</span></button><button type="button" aria-pressed={queueView === "email"} onClick={() => setQueueView("email")}>Verified email <span>{sourceBackedEmails.length}</span></button><button type="button" aria-pressed={queueView === "needs_review"} onClick={() => setQueueView("needs_review")}>Needs review <span>{awaitingReview.length}</span></button><button type="button" aria-pressed={queueView === "selected"} onClick={() => setQueueView("selected")}>Selected <span>{selected.length}</span></button></nav>
      {selected.length > 0 && <div className="selection-bar"><div><strong>{selected.length} selected</strong><small>Ready to export or turn into outreach.</small></div><div className="row-actions wrap"><button className="button secondary small" type="button" onClick={() => void copyEmails()}><Clipboard size={14}/>Copy verified emails</button><a className="button secondary small" href={`/api/leads/export?selected=true${runId ? `&runId=${runId}` : ""}`}><Download size={14}/>Export leads</a><a className="button small" href="#outreach"><Mail size={14}/>Prepare outreach</a><button className="icon-button" type="button" aria-label="Clear selected leads" onClick={() => void clearSelection()}><X size={15}/></button></div></div>}
      {duplicatePairs.length > 0 && <details className="duplicate-review"><summary><TriangleAlert size={16}/><span><strong>{duplicatePairs.length} possible duplicate pair{duplicatePairs.length === 1 ? "" : "s"}</strong><small>Review and merge only when you are confident.</small></span></summary><div>{duplicatePairs.map(([primary, duplicate]) => <div className="duplicate-pair" key={`${primary.id}-${duplicate.id}`}><span>{primary.organizationName} · {formatDate(primary.researchedAt)}</span><span>{duplicate.organizationName} · {formatDate(duplicate.researchedAt)}</span><button className="button secondary small" onClick={() => void mergeDuplicates(primary.id, duplicate.id)}>Merge into first</button></div>)}</div></details>}
      {filtered.length ? <div className="lead-list">{filtered.map((lead) => <LeadCard key={lead.id} lead={{ ...lead, fitExplanation: cleanDisplayText(lead.fitExplanation), outreachAngle: cleanDisplayText(lead.outreachAngle), recommendedAction: cleanDisplayText(lead.recommendedAction), evidenceSummary: cleanDisplayText(lead.evidenceSummary), sources: lead.sources.map((source) => ({ ...source, title: cleanDisplayText(source.title), claim: cleanDisplayText(source.claim) })), selected: isSelected(lead) }} onPatch={patchLead} onSave={saveLead} onDelete={async () => { if (confirm(`Delete ${cleanDisplayText(lead.organizationName)}?`)) { await apiRequest(`/api/leads?id=${lead.id}`, { method: "DELETE" }); await workspace.refresh(); }}}/>)}</div> : <div className="empty-state"><ContactRound/><h3>{visibleLeads.length ? "No leads match this view" : "No leads yet"}</h3><p>{visibleLeads.length ? "Try another queue view or reset the filters." : "Open Find new leads above to build your first qualified list."}</p>{visibleLeads.length > 0 && <button className="button secondary small" type="button" onClick={clearFilters}>Show all leads</button>}</div>}
    </section>
    <section id="outreach" className="panel section-block outreach-panel"><div className="panel-heading"><div><span className="eyebrow">Step 3 · Act</span><h2>Prepare personalized outreach</h2><p className="muted">{selected.length ? `${selected.length} selected lead${selected.length === 1 ? "" : "s"} will become reviewable drafts.` : "Select leads from the queue to start."}</p></div><button className="button secondary small" type="button" disabled={!selected.length} onClick={() => void copyEmails()}><Clipboard size={15}/>Copy verified emails</button></div>
      {!selected.length && <div className="outreach-empty"><Mail size={18}/><span><strong>No leads selected yet</strong><small>Use the checkbox on a lead card, or select all sales-ready leads above.</small></span></div>}
      <form className="form-grid" onSubmit={createOutreach}><label>Campaign name<input name="name" required defaultValue="Qualified summit sales outreach"/></label><label>Mode<select name="mode" defaultValue="sales_motion"><option value="sales_motion">Adapt to each lead’s sales path</option><option value="partner_share">Partner-share request</option><option value="direct_invitation">Direct invitation</option></select></label><label className="span-two">Campaign instruction<input name="instructions" placeholder="Use one low-friction ask and make group-ticket value concrete."/></label><fieldset className="span-two"><legend>Context for event facts and voice</legend><ContextPicker documents={activeContext}/></fieldset><div className="span-two form-footer"><p>No email is sent. Drafts remain local until reviewed and exported.</p><button className="button" disabled={!selected.length || isActive(outreachOperation)}><Mail size={17}/>{isActive(outreachOperation) ? "Drafting in background" : "Create sales outreach"}</button></div></form>
      <InlineOperation operation={outreachOperation}/>
      {latestOutreach && <div className="campaign-preview"><div className="section-heading"><div><span className="type-label">Saved outreach campaign</span><h3>{latestOutreach.name}</h3><small>{latestOutreach.previewText || latestOutreach.callToAction}</small></div><div className="row-actions wrap">{state.outreachCampaigns.length > 1 && <select aria-label="Open saved outreach campaign" value={latestOutreach.id} onChange={(event) => setOutreachId(event.target.value)}>{state.outreachCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} · {formatDate(campaign.updatedAt)}</option>)}</select>}<button className="button secondary small" onClick={async () => { const approved = latestOutreach.recipients.filter((recipient) => recipient.reviewStatus === "reviewed" && !recipient.excluded && recipient.email).map((recipient) => recipient.email).join(", "); if (!approved) return setMessage("No reviewed recipient addresses are ready to copy."); await navigator.clipboard.writeText(approved); setMessage("All reviewed recipient addresses copied."); }}><Clipboard size={14}/>Copy approved addresses</button><button className="button secondary small" disabled={isActive(outreachRegenOperation)} onClick={() => void regenerateAllOutreach(latestOutreach.id)}><RefreshCw size={14}/>{isActive(outreachRegenOperation) ? "Regenerating…" : "Regenerate all"}</button><a className="button secondary small" href={`/api/export?campaignId=${latestOutreach.id}`}><Download size={15}/>Export reviewed CSV</a></div></div><InlineOperation operation={outreachRegenOperation} compact/><details className="saved-context-summary"><summary>Context used by outreach regeneration · {latestOutreach.contextDocumentIds.filter((id) => state.contextDocuments.some((document) => document.id === id && document.active)).length} active documents</summary><ul>{latestOutreach.contextDocumentIds.map((id) => { const document = state.contextDocuments.find((item) => item.id === id); return <li key={id}>{document ? `${document.title}${document.active ? "" : " (inactive — excluded from regeneration)"}` : "Deleted context — excluded from regeneration"}</li>; })}</ul></details><MasterOutreachEditor campaign={latestOutreach} onRefresh={workspace.refresh} onMessage={setMessage}/><div className="recipient-list">{latestOutreach.recipients.map((recipient) => <RecipientEditor key={recipient.id} recipient={recipient} campaign={latestOutreach} lead={state.leads.find((lead) => lead.id === recipient.leadId)} onUpdate={updateRecipient} onRefresh={workspace.refresh} onMessage={setMessage}/>)}</div></div>}
    </section>
  </div>;
}

function LeadCard({ lead, onPatch, onSave, onDelete }: { lead: LeadRecord; onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>; onSave: (event: React.FormEvent<HTMLFormElement>, lead: LeadRecord) => Promise<void>; onDelete: () => Promise<void> }) {
  const scoreBreakdown = lead.qualification?.scoreBreakdown ?? { audienceFit: 0, revenuePotential: 0, distribution: 0, contactability: 0, localRelevance: 0, timing: 0, evidenceQuality: 0 };
  return <article className={`lead-card ${lead.selected ? "selected" : ""}`}>
    <div className="lead-select"><input type="checkbox" aria-label={`Select ${lead.organizationName}`} title="Add to outreach selection" checked={lead.selected} onChange={(event) => void onPatch(lead.id, { selected: event.target.checked })}/></div>
    <div className="lead-main">
      <div className="lead-title"><div className="lead-score" aria-label={`Priority score ${lead.priorityScore} out of 100`}><strong>{lead.priorityScore}</strong><small>/100</small><span><i style={{ width: `${Math.max(4, lead.priorityScore)}%` }}/></span></div><div className="lead-identity"><div className="inline-labels"><span className={`badge ${lead.priorityTier === "hot" || lead.priorityTier === "strong" ? "success" : lead.priorityTier === "nurture" ? "warning" : ""}`}>{prettyLabel(lead.priorityTier)}</span><span className="type-label">{prettyLabel(lead.targetSegment)}</span><span className="badge">{prettyLabel(lead.salesMotion)}</span></div><h3>{cleanDisplayText(lead.eventName || lead.organizationName)}</h3>{lead.eventName && <p>Organized by {cleanDisplayText(lead.eventOrganizer || lead.organizationName)}</p>}<small>{[lead.organizationType, lead.city, lead.region].map(cleanDisplayText).filter(Boolean).join(" · ")}{lead.eventStartDate ? ` · ${formatDate(lead.eventStartDate)}` : ""}</small></div><div className="lead-review"><label><span className="sr-only">Review status</span><select aria-label={`Review status for ${cleanDisplayText(lead.organizationName)}`} value={lead.reviewStatus} onChange={(event) => void onPatch(lead.id, { reviewStatus: event.target.value })}><option value="unreviewed">Unreviewed</option><option value="reviewed">Reviewed</option><option value="needs_review">Needs review</option><option value="rejected">Rejected</option></select></label></div></div>
      <div className="lead-signals"><span className={`signal ${lead.verificationStatus === "source_backed" ? "success" : lead.verificationStatus === "requires_review" ? "warning" : ""}`}><i/>{lead.verificationStatus === "source_backed" ? "Source-backed contact" : lead.contactPageUrl ? "Official contact page" : "Contact needs research"}</span><span>{lead.sources.length} source{lead.sources.length === 1 ? "" : "s"}</span><span>{prettyLabel(lead.confidence)} evidence</span>{Object.keys(lead.userEdits).length > 0 && <span>User edited</span>}</div>
      <div className="lead-snapshot"><div className="lead-next-action"><span>Recommended next move</span><p>{cleanDisplayText(lead.nextBestAction || lead.recommendedAction)}</p></div><div className="lead-contact"><span>Best contact path</span>{lead.contactEmail ? <p><strong>{lead.contactEmail}</strong><small>{[lead.contactName, lead.contactRole || lead.emailCategory.replaceAll("_", " ")].map(cleanDisplayText).filter(Boolean).join(" · ")}</small></p> : lead.contactPageUrl ? <a href={lead.contactPageUrl} target="_blank" rel="noopener noreferrer">Open official contact page <ExternalLink size={13}/></a> : <p className="muted">No public contact method yet</p>}</div></div>
      <details className="evidence"><summary><span><strong>Inspect qualification, {lead.sources.length} source{lead.sources.length === 1 ? "" : "s"}, and review notes</strong><small>Why it fits, scoring evidence, sources, and editable details</small></span><ArrowRight size={15}/></summary><div className="evidence-body"><div className="lead-detail-grid"><div><span>Why it can sell tickets</span><p>{lead.fitExplanation}</p></div><div><span>Suggested sales angle</span><p>{lead.outreachAngle || lead.recommendedAction}</p></div></div>{lead.warnings.length > 0 && <div className="warnings"><TriangleAlert size={15}/><ul>{lead.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}<div className="evidence-summary"><strong>Why it scored {lead.priorityScore}/100</strong><div className="score-breakdown"><span>Audience <b>{scoreBreakdown.audienceFit}/25</b></span><span>Revenue <b>{scoreBreakdown.revenuePotential}/20</b></span><span>Distribution <b>{scoreBreakdown.distribution}/15</b></span><span>Contact <b>{scoreBreakdown.contactability}/15</b></span><span>Local <b>{scoreBreakdown.localRelevance}/10</b></span><span>Timing <b>{scoreBreakdown.timing}/10</b></span><span>Evidence <b>{scoreBreakdown.evidenceQuality}/5</b></span></div><p>{lead.evidenceSummary}</p><small>Verified {formatDate(lead.lastVerifiedAt)}</small></div><div className="source-list">{lead.sources.map((source) => <a key={source.id || source.url} href={source.url} target="_blank" rel="noopener noreferrer"><span><strong>{source.title}</strong><small>{source.claim}</small></span><ExternalLink size={15}/></a>)}</div><form className="form-grid inner edit-lead" onSubmit={(event) => void onSave(event, lead)}><label>Contact name<input name="contactName" defaultValue={lead.contactName || ""}/></label><label>Contact role<input name="contactRole" defaultValue={lead.contactRole || ""}/></label><label>Email<input name="contactEmail" type="email" defaultValue={lead.contactEmail || ""}/><small>User edits are labeled and do not become source-backed.</small></label><label className="span-two">Recommended action<textarea name="recommendedAction" rows={2} defaultValue={lead.recommendedAction}/></label><label className="span-two">Fit explanation<textarea name="fitExplanation" rows={2} defaultValue={lead.fitExplanation}/></label><label className="span-two">Rejection reason or review note<textarea name="rejectionReason" rows={2} defaultValue={lead.rejectionReason || ""} placeholder="Example: Audience is too junior, already contacted, outside travel radius, or no viable distribution path."/></label><div className="span-two edit-actions"><button className="button secondary small">Save review details</button><button className="button secondary small danger-text" type="button" onClick={() => void onDelete()}><Trash2 size={14}/>Delete lead</button></div></form></div></details>
    </div>
  </article>;
}

function prettyLabel(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

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
