"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BookOpenText, CalendarDays, Check, CircleHelp, Clipboard, Clock3, Download, ImageIcon, Pencil, Plus, RotateCcw, Sparkles, Trash2, Users, X } from "lucide-react";
import type { SummitAgendaBatch, SummitAgendaBatchSummary, SummitAgendaData, SummitAgendaPerson, SummitAgendaSession } from "@/lib/types";
import { InlineOperation, useOperations } from "./operations";
import { apiRequest, ConnectionBadge, formatDateTime, PageState, useWorkspace } from "./workspace";

interface AgendaResponse { agenda: SummitAgendaData; batches: SummitAgendaBatchSummary[]; batch: SummitAgendaBatch | null }
const PIXELS_PER_MINUTE = 2.7;
const formats = ["Keynote", "Fireside", "Panel", "Workshop", "Talk", "Break"];
const AGENDA_AGENT_PROMPT = `Create the Live Agenda for this summit in the active Marketing Hub workspace.

Use every source file I attach or point you to, including downloaded event webpages, agenda documents, speaker directories, and image folders. Treat those sources as authoritative. Extract every agenda day, stage or track, session title, session type, start and end time, speaker, moderator, role, company, and matching speaker portrait.

Populate the active workspace's Live Agenda directly; do not ask me to enter sessions manually. Keep new-workspace data isolated from other workspaces and do not alter existing campaigns, context, or generated assets. Preserve exact source wording where available, match each portrait to the correct person, avoid duplicates, and leave unknown fields blank rather than inventing facts.

Before finishing, verify that all source sessions are represented, times and day boundaries are valid, overlapping sessions remain on their correct stages, every person is attached to the right session, and portrait files render. Then summarize what you imported and clearly list any missing or ambiguous source information that still needs my help.`;

export function SummitAgendaClient({ initialBatchId = null }: { initialBatchId?: string | null }) {
  const workspace = useWorkspace();
  const operations = useOperations();
  const [data, setData] = useState<AgendaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState<"day1" | "day2">("day1");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<SummitAgendaSession | null>(null);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File>>({});
  const [saving, setSaving] = useState(false);
  const [copiedCaptionId, setCopiedCaptionId] = useState<string | null>(null);
  const [agendaGuidePinned, setAgendaGuidePinned] = useState(false);
  const [agendaPromptCopied, setAgendaPromptCopied] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(initialBatchId);
  const [followLatestBatch, setFollowLatestBatch] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [handledOperationId, setHandledOperationId] = useState<string | null>(null);
  const operation = operations.findOperation({ id: operationId, kind: "summit_agenda_batch", originPath: "/summit-agenda" });
  const busy = Boolean(operation && ["queued", "running", "cancel_requested"].includes(operation.status));

  const load = useCallback(async (batchId: string | null = null) => {
    try {
      const response = await apiRequest<AgendaResponse>(batchId ? `/api/summit-agenda?batch=${encodeURIComponent(batchId)}` : "/api/summit-agenda");
      setData(response);
      setActiveBatchId(response.batch?.id || null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load the summit agenda.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(initialBatchId), 0);
    return () => window.clearTimeout(timer);
  }, [initialBatchId, load]);
  useEffect(() => {
    if (!operation || handledOperationId === operation.id || !["completed", "partially_completed", "failed", "canceled", "interrupted"].includes(operation.status)) return;
    const timer = window.setTimeout(() => {
      setHandledOperationId(operation.id);
      void load(operation.resultEntityId || (followLatestBatch ? null : activeBatchId)).then(() => {
        if (operation.status === "completed") setSelected(new Set());
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [operation, handledOperationId, load, followLatestBatch, activeBatchId]);
  useEffect(() => {
    if (!busy || !operation?.updatedAt) return;
    const timer = window.setTimeout(() => void load(operation.resultEntityId || (followLatestBatch ? null : activeBatchId)), 0);
    return () => window.clearTimeout(timer);
  }, [busy, operation?.updatedAt, operation?.resultEntityId, followLatestBatch, activeBatchId, load]);

  const day = data?.agenda.days.find((item) => item.key === activeDay) || null;
  const batches = data?.batches || [];
  const activeBatch = data?.batch || null;
  const activeBatchCounts = activeBatch ? {
    completed: activeBatch.results.filter((result) => result.status === "completed").length,
    failed: activeBatch.results.filter((result) => result.status === "failed").length,
    canceled: activeBatch.results.filter((result) => result.status === "canceled").length,
    active: activeBatch.results.filter((result) => result.status === "queued" || result.status === "generating").length
  } : null;
  const readyOnDay = day?.sessions.filter((session) => !generationIssue(session)) || [];
  const selectedSessions = data?.agenda.days.flatMap((item) => item.sessions).filter((session) => selected.has(session.id)) || [];

  if (!workspace.state) return <PageState loading={workspace.loading} error={workspace.error} retry={workspace.refresh}/>;
  if (loading && !data) return <div className="page"><div className="skeleton hero-skeleton"/><div className="skeleton agenda-skeleton"/></div>;
  if (!data || !day) return <div className="page"><div className="empty-state danger"><CalendarDays/><h1>Agenda could not open</h1><p>{message || "The extracted agenda data is unavailable."}</p><button className="button" onClick={() => void load()}>Retry</button></div></div>;

  function toggleSession(session: SummitAgendaSession) {
    if (generationIssue(session)) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(session.id)) next.delete(session.id); else next.add(session.id);
      return next;
    });
  }

  async function generate() {
    if (!selected.size) return;
    setMessage(null);
    try {
      const started = await operations.startOperation("/api/summit-agenda", { method: "POST", body: JSON.stringify({ sessionIds: [...selected] }) });
      setOperationId(started.id);
      setHandledOperationId(null);
      setFollowLatestBatch(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not start agenda image generation."); }
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true); setMessage(null);
    try {
      await apiRequest<{ agenda: SummitAgendaData }>("/api/summit-agenda", { method: "PATCH", body: JSON.stringify({
        sessionId: editing.id, title: editing.title, format: editing.format, start: editing.start, end: editing.end, people: editing.people
      }) });
      for (const [personId, file] of Object.entries(pendingFiles)) {
        const form = new FormData(); form.set("sessionId", editing.id); form.set("personId", personId); form.set("file", file);
        await apiRequest("/api/summit-agenda/portrait", { method: "POST", body: form });
      }
      await load(activeBatchId); setEditing(null); setPendingFiles({});
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the session."); }
    finally { setSaving(false); }
  }

  async function resetEdit() {
    if (!editing || !confirm("Restore this card to the exact downloaded agenda data?")) return;
    setSaving(true); setMessage(null);
    try {
      await apiRequest("/api/summit-agenda", { method: "PUT", body: JSON.stringify({ sessionId: editing.id, action: "reset" }) });
      await load(activeBatchId); setEditing(null); setPendingFiles({});
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not restore the source session."); }
    finally { setSaving(false); }
  }

  async function removeBatch(batchId: string) {
    if (!confirm("Delete this generated agenda batch and its local PNG files?")) return;
    try { await apiRequest(`/api/summit-agenda?batch=${batchId}`, { method: "DELETE" }); setActiveBatchId(null); setFollowLatestBatch(false); await load(); await workspace.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not delete the batch."); }
  }

  async function copyCaption(resultId: string, caption: string) {
    try {
      await navigator.clipboard.writeText(caption);
      setCopiedCaptionId(resultId);
      window.setTimeout(() => setCopiedCaptionId((current) => current === resultId ? null : current), 1800);
    } catch {
      setMessage("Could not copy the caption. Select the text and copy it manually.");
    }
  }

  async function copyAgendaPrompt() {
    try {
      await navigator.clipboard.writeText(AGENDA_AGENT_PROMPT);
      setAgendaPromptCopied(true);
      window.setTimeout(() => setAgendaPromptCopied(false), 1800);
    } catch {
      setMessage("Could not copy the agenda prompt. Select the prompt and copy it manually.");
    }
  }

  const hasAgendaSessions = data.agenda.days.some((item) => item.sessions.length > 0);
  if (!hasAgendaSessions) return <div className="page summit-agenda-page">
    <header className="page-header split"><div><span className="eyebrow"><span className="live-pulse"/>Live media studio</span><h1>Summit Agenda</h1><p className="lede">Build live session graphics for {workspace.state.activeWorkspace.name} once the program and speaker assets are ready.</p></div><ConnectionBadge state={workspace.state}/></header>
    {message && <div className="notice danger" role="status">{message}</div>}
    <div className="empty-state agenda-workspace-empty"><CalendarDays/><div className="agenda-empty-title"><h2>No agenda in this workspace</h2><div className={`agenda-agent-guide ${agendaGuidePinned ? "open" : ""}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAgendaGuidePinned(false); }} onKeyDown={(event) => { if (event.key === "Escape") { setAgendaGuidePinned(false); (event.currentTarget.querySelector(".agenda-guide-trigger") as HTMLButtonElement | null)?.focus(); } }}><button className="agenda-guide-trigger" type="button" aria-label="How to create the agenda with your AI agent" aria-expanded={agendaGuidePinned} aria-controls="agenda-agent-guide" onClick={() => setAgendaGuidePinned((open) => !open)}><CircleHelp size={17}/></button><section id="agenda-agent-guide" className="agenda-guide-popover"><strong>Build this with your agent</strong><p>Attach or point your agent to the downloaded event website, agenda, speaker list, and portrait files. Then copy and send this prompt:</p><textarea aria-label="Prompt for your AI agent" readOnly value={AGENDA_AGENT_PROMPT} rows={9} onFocus={(event) => event.currentTarget.select()}/><button className="button small" type="button" onClick={() => void copyAgendaPrompt()}>{agendaPromptCopied ? <Check size={14}/> : <Clipboard size={14}/>} {agendaPromptCopied ? "Copied" : "Copy agent prompt"}</button></section></div></div><p>New workspaces start clean. Give your AI agent the event program, speaker details, and portraits so it can build the agenda for you.</p><Link className="button secondary" href="/context"><BookOpenText size={15}/>Open Context</Link></div>
  </div>;

  const dayStart = Math.floor(Math.min(...day.sessions.map((session) => session.start)) / 20) * 20;
  const dayEnd = Math.ceil(Math.max(...day.sessions.map((session) => session.end)) / 20) * 20;
  const timelineHeight = Math.max(760, (dayEnd - dayStart) * PIXELS_PER_MINUTE);
  const ticks = Array.from({ length: Math.ceil((dayEnd - dayStart) / 20) + 1 }, (_, index) => dayStart + index * 20);

  return <div className="page summit-agenda-page">
    <header className="page-header split"><div><span className="eyebrow"><span className="live-pulse"/>Live media studio</span><h1>Summit Agenda</h1><p className="lede">Select any ready session, then create one polished AGI Summit live graphic per card. The calendar below mirrors the downloaded Day 1 and Day 2 boards and keeps every source portrait attached to its session.</p></div><ConnectionBadge state={workspace.state}/></header>
    {message && <div className={/could not|missing|needs|failed/i.test(message) ? "notice danger" : "notice"} role="status">{message}</div>}

    <section className="agenda-command panel">
      <div className="agenda-day-tabs" role="tablist" aria-label="Summit day">
        {data.agenda.days.map((item) => <button key={item.key} role="tab" aria-selected={activeDay === item.key} className={activeDay === item.key ? "active" : ""} onClick={() => setActiveDay(item.key)}><strong>{item.label}</strong><small>{item.date}</small></button>)}
      </div>
      <div className="agenda-selection-summary"><span className="selection-orb"><Check size={16}/></span><div><strong>{selected.size} selected</strong><small>{selected.size ? `${selectedSessions.map((session) => session.startLabel).slice(0, 3).join(", ")}${selected.size > 3 ? ` +${selected.size - 3}` : ""}` : "Click a ready card to build a batch"}</small></div></div>
      <div className="agenda-command-actions"><button className="button secondary small" onClick={() => setSelected(new Set(readyOnDay.map((session) => session.id)))}>Select ready day</button>{selected.size > 0 && <button className="button secondary small" onClick={() => setSelected(new Set())}>Clear</button>}<button className="button agenda-generate" disabled={!selected.size || busy || (!workspace.state.demoMode && !workspace.state.connection.connected)} onClick={() => void generate()}><Sparkles size={16}/>{busy ? "Generating in background" : `Generate ${selected.size || ""} live post${selected.size === 1 ? "" : "s"}`}</button></div>
    </section>
    <InlineOperation operation={operation}/>

    <section className="agenda-board-section">
      <div className="section-heading agenda-board-heading"><div><h2>{day.label} schedule</h2><p className="muted">{day.sessions.length} source sessions · {readyOnDay.length} ready to generate · click Edit to fill any source gaps</p></div><span className="source-lock"><Check size={14}/>Verified against saved HTML</span></div>
      <div className="agenda-calendar-shell">
        <div className="agenda-calendar-head"><div className="agenda-time-corner"><Clock3 size={15}/>Local</div>{data.agenda.stages.map((stage) => { const count = day.sessions.filter((session) => session.stage === stage.key).length; return <div key={stage.key} className="agenda-stage-head"><strong>{stage.name}</strong><small>{count} session{count === 1 ? "" : "s"}</small></div>; })}</div>
        <div className="agenda-calendar-body" style={{ height: timelineHeight }}>
          <div className="agenda-time-rail">{ticks.map((tick) => <span key={tick} style={{ top: (tick - dayStart) * PIXELS_PER_MINUTE }}>{formatClock(tick)}</span>)}</div>
          {data.agenda.stages.map((stage) => {
            const stageSessions = day.sessions.filter((session) => session.stage === stage.key);
            const layouts = computeLayouts(stageSessions);
            return <div className="agenda-stage-lane" key={stage.key}>{ticks.map((tick) => <i className="agenda-grid-line" aria-hidden="true" key={tick} style={{ top: (tick - dayStart) * PIXELS_PER_MINUTE }}/>) }{stageSessions.map((session) => {
              const issue = generationIssue(session); const layout = layouts.get(session.id)!; const checked = selected.has(session.id);
              const cardStyle = {
                top: (session.start - dayStart) * PIXELS_PER_MINUTE + 4,
                height: Math.max(26, (session.end - session.start) * PIXELS_PER_MINUTE - 7),
                left: `calc(${layout.lane * (100 / layout.lanes)}% + 4px)`,
                width: `calc(${100 / layout.lanes}% - 8px)`
              };
              return <article key={session.id} className={`agenda-session-card format-${session.format.toLowerCase()} ${checked ? "selected" : ""} ${issue ? "not-ready" : ""}`} style={cardStyle} onClick={() => toggleSession(session)} title={issue || `${cleanAgendaTitle(session.title)} · ${session.people.map((person) => person.name).join(", ")}`}>
                <div className="agenda-card-top"><span className="agenda-card-check" aria-label={checked ? "Selected" : issue || "Ready to select"}>{checked ? <Check size={13}/> : issue ? <AlertTriangle size={12}/> : null}</span><time>{session.startLabel}–{session.endLabel}</time><span className="agenda-format">{session.format}</span><button className="agenda-edit-button" aria-label={`Edit ${cleanAgendaTitle(session.title) || "session"}`} onClick={(event) => { event.stopPropagation(); setEditing({ ...structuredClone(session), title: cleanAgendaTitle(session.title) }); setPendingFiles({}); }}><Pencil size={12}/></button></div>
                <h3>{cleanAgendaTitle(session.title) || "Title not supplied"}</h3>
                <div className="agenda-card-people"><div className="agenda-mini-portraits">{session.people.slice(0, 5).map((person) => person.photo ? <Image key={person.id} src={portraitUrl(person.photo, 56)} alt="" width={28} height={28} unoptimized/> : <span key={person.id}><Users size={12}/></span>)}{session.people.length > 5 && <b>+{session.people.length - 5}</b>}</div><small>{session.people.length ? session.people.map((person) => person.name).join(" · ") : "No speakers attached"}</small></div>
                {issue && <span className="agenda-card-issue">{issue}</span>}
              </article>;
            })}</div>;
          })}
        </div>
      </div>
    </section>

    {batches.length > 0 && <section className="section-block agenda-results-section"><div className="section-heading split spotlight-batch-heading"><div><h2>Generated live posts</h2><p className="muted">First-pass provider canvases are saved locally without cropping or resizing.</p></div><div className="toolbar spotlight-batch-controls"><select className="spotlight-batch-select" aria-label="Open generated live-post batch" value={activeBatch?.id || ""} onChange={(event) => { const id = event.target.value; setOperationId(null); setFollowLatestBatch(false); setActiveBatchId(id); void load(id); }}>{batches.map((batch) => <option key={batch.id} value={batch.id}>{formatDateTime(batch.createdAt)} · {batch.status.replaceAll("_", " ")} · {batch.resultCount} post{batch.resultCount === 1 ? "" : "s"}</option>)}</select>{activeBatch && <button className="button secondary small danger-text" onClick={() => void removeBatch(activeBatch.id)}><Trash2 size={14}/>Delete</button>}</div></div>
      {activeBatch && activeBatchCounts && <>
        <div className="spotlight-batch-summary"><span><strong>{activeBatchCounts.completed}</strong> completed</span><span><strong>{activeBatchCounts.failed}</strong> failed</span>{activeBatchCounts.canceled > 0 && <span><strong>{activeBatchCounts.canceled}</strong> canceled</span>}{activeBatchCounts.active > 0 && <span><strong>{activeBatchCounts.active}</strong> in progress</span>}<span><strong>{activeBatch.model}</strong> image model</span><span><strong>3:4</strong> requested composition</span></div>
        <div className="agenda-result-grid">{activeBatch.results.map((result, resultIndex) => <article className="agenda-result-card" key={result.id}>
          <div className="agenda-result-heading"><div><span className={`status-icon ${result.status === "completed" ? "completed" : result.status === "failed" ? "failed" : "running"}`}>{result.status === "completed" ? <Check size={17}/> : result.status === "failed" ? <AlertTriangle size={17}/> : <Sparkles size={17}/>}</span><div><h3>{cleanAgendaTitle(result.session.title)}</h3><small>{result.session.startLabel}–{result.session.endLabel} · {result.session.stageName}</small></div></div>{result.imageAssetId && <span className="badge success">C2PA stripped</span>}</div>
          {result.error && <div className="warnings"><AlertTriangle/><span>{result.error}</span></div>}
          {result.imageAssetId ? <><div className="agenda-result-image"><Image src={`/api/summit-agenda/asset?id=${result.imageAssetId}&preview=1`} alt={`${result.session.title} live agenda post`} width={1080} height={1440} loading={resultIndex === 0 ? "eager" : "lazy"} unoptimized/></div><a className="button secondary" href={`/api/summit-agenda/asset?id=${result.imageAssetId}&download=1`}><Download size={15}/>Download provider PNG</a></> : <div className="agenda-result-placeholder"><ImageIcon/><span>{result.status.replaceAll("_", " ")}</span></div>}
          <div className="agenda-caption"><div className="copy-heading"><strong>Social media caption</strong><button className="icon-button" aria-label={`Copy ${result.session.title} caption`} onClick={() => void copyCaption(result.id, result.caption)}>{copiedCaptionId === result.id ? <Check size={15}/> : <Clipboard size={15}/>}</button></div><pre>{result.caption}</pre></div>
        </article>)}</div>
      </>}
    </section>}

    {editing && <div className="agenda-modal" role="dialog" aria-modal="true" aria-labelledby="agenda-edit-title"><button className="agenda-modal-backdrop" aria-label="Close editor" onClick={() => !saving && setEditing(null)}/><div className="agenda-modal-panel"><div className="agenda-modal-head"><div><span className="eyebrow">{editing.stageName} · {editing.startLabel}</span><h2 id="agenda-edit-title">Edit session data</h2><p>Changes are stored together and become the exact context sent to image generation.</p></div><button className="icon-button" onClick={() => setEditing(null)} disabled={saving} aria-label="Close"><X size={18}/></button></div>
      <div className="agenda-edit-fields"><label className="span-two">Talk title<input value={editing.title} maxLength={320} onChange={(event) => setEditing({ ...editing, title: event.target.value })} placeholder="Add the exact live-post headline"/></label><label>Session type<select value={editing.format} onChange={(event) => setEditing({ ...editing, format: event.target.value })}>{formats.map((format) => <option key={format}>{format}</option>)}</select></label><div className="agenda-time-fields"><label>Starts<input type="time" value={timeInput(editing.start)} onChange={(event) => setEditing({ ...editing, start: minutesFromInput(event.target.value) })}/></label><label>Ends<input type="time" value={timeInput(editing.end)} onChange={(event) => setEditing({ ...editing, end: minutesFromInput(event.target.value) })}/></label></div></div>
      <div className="agenda-people-editor"><div className="panel-heading"><div><h3>People and portraits</h3><small>Use the real source photo or upload a replacement.</small></div><button className="button secondary small" onClick={() => setEditing({ ...editing, people: [...editing.people, newPerson()] })}><Plus size={14}/>Add person</button></div>{editing.people.length ? <div className="agenda-person-list">{editing.people.map((person, index) => <div className="agenda-person-row" key={person.id}><div className="agenda-person-photo">{person.photo ? <Image src={portraitUrl(person.photo, 128)} alt={`${person.name} portrait`} width={64} height={64} unoptimized/> : <Users size={20}/>}<label className="agenda-photo-button"><ImageIcon size={13}/>{pendingFiles[person.id]?.name || "Change"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) setPendingFiles((current) => ({ ...current, [person.id]: file })); }}/></label></div><div className="agenda-person-fields"><label>Name<input value={person.name} onChange={(event) => updateDraftPerson(setEditing, editing, person.id, { name: event.target.value })}/></label><label>Role<input value={person.role} onChange={(event) => updateDraftPerson(setEditing, editing, person.id, { role: event.target.value })}/></label><label>Company<input value={person.company} onChange={(event) => updateDraftPerson(setEditing, editing, person.id, { company: event.target.value })}/></label><label className="moderator-check"><input type="radio" name="moderator" checked={person.moderator} onChange={() => setEditing({ ...editing, people: editing.people.map((item) => ({ ...item, moderator: item.id === person.id })) })}/>Moderator</label></div><button className="icon-button danger-text" aria-label={`Remove ${person.name}`} onClick={() => { setEditing({ ...editing, people: editing.people.filter((item) => item.id !== person.id) }); setPendingFiles((current) => { const next = { ...current }; delete next[person.id]; return next; }); }}><Trash2 size={15}/></button><span className="agenda-person-number">{index + 1}</span></div>)}</div> : <div className="compact-empty"><Users/><div><strong>No people attached</strong><p>Add at least one person and portrait before generating.</p></div></div>}</div>
      <div className="agenda-modal-footer"><button className="button secondary danger-text" onClick={() => void resetEdit()} disabled={saving}><RotateCcw size={14}/>Restore downloaded data</button><div><button className="button secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</button><button className="button" onClick={() => void saveEdit()} disabled={saving || editing.end <= editing.start || editing.people.some((person) => !person.name.trim())}>{saving ? "Saving…" : "Save session"}</button></div></div>
    </div></div>}
  </div>;
}

function generationIssue(session: SummitAgendaSession) {
  if (!session.title.trim()) return "Add title";
  if (!session.people.length) return "Add speaker";
  const missing = session.people.find((person) => !person.photo);
  return missing ? `Photo needed: ${missing.name}` : null;
}

function cleanAgendaTitle(title: string) {
  const corrections: Record<string, string> = {
    "AGI the IntelligentMachineGuild.org and the Real Three Laws": "AGI, the Intelligent Machine Guild, and the Real Three Laws",
    "Winning when Code is Free: How to b Build Defensible AI Startups that Scale": "Winning When Code Is Free: How to Build Defensible AI Startups That Scale",
    "World Positive Al: Building for Human Flourishing": "World Positive AI: Building for Human Flourishing",
    "The Future of AI Interferce": "The Future of AI Interfaces",
    "how agents can lead to abundance for all by accelerating scientific discovery": "How Agents Can Lead to Abundance for All by Accelerating Scientific Discovery",
    "Investing in the Future of Physicial AI": "Investing in the Future of Physical AI",
    "Al Infrastructure for an Accelerating World: From Data Centers to Enterprise Edge": "AI Infrastructure for an Accelerating World: From Data Centers to Enterprise Edge"
  };
  return corrections[title] || title;
}

function portraitUrl(token: string, size?: number) { return `/api/summit-agenda/portrait?token=${encodeURIComponent(token)}${size ? `&size=${size}` : ""}`; }

function formatClock(minutes: number) {
  const hour = Math.floor(minutes / 60) % 24;
  return `${hour > 12 ? hour - 12 : hour === 0 ? 12 : hour}:${String(minutes % 60).padStart(2, "0")}`;
}

function timeInput(minutes: number) { return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
function minutesFromInput(value: string) { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }

function newPerson(): SummitAgendaPerson {
  return { id: `custom-${crypto.randomUUID()}`, name: "", role: "", company: "", moderator: false, photo: null };
}

function updateDraftPerson(setEditing: React.Dispatch<React.SetStateAction<SummitAgendaSession | null>>, editing: SummitAgendaSession, personId: string, patch: Partial<SummitAgendaPerson>) {
  setEditing({ ...editing, people: editing.people.map((person) => person.id === personId ? { ...person, ...patch } : person) });
}

function computeLayouts(sessions: SummitAgendaSession[]) {
  const endings: number[] = [];
  const assigned = sessions.slice().sort((a, b) => a.start - b.start || a.end - b.end).map((session) => {
    let lane = endings.findIndex((end) => end <= session.start);
    if (lane < 0) { lane = endings.length; endings.push(session.end); } else endings[lane] = session.end;
    return { session, lane };
  });
  const lanes = Math.max(1, endings.length);
  return new Map(assigned.map(({ session, lane }) => [session.id, { lane, lanes }]));
}
