"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BookOpenText,
  Check,
  ChevronDown,
  Image as ImageIcon,
  LayoutGrid,
  Plus,
  Target,
  Trash2,
  UsersRound,
  X
} from "lucide-react";
import type { WorkspaceState, WorkspaceSummary } from "@/lib/types";
import { apiRequest } from "./workspace";

export function WorkspaceSwitcher({ state, onRefresh }: { state: WorkspaceState | null; onRefresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"create" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationName, setConfirmationName] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const active = state?.activeWorkspace || null;

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (open && root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (dialog && !busy) setDialog(null);
      else setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, dialog, busy]);

  async function select(workspace: WorkspaceSummary) {
    if (!state || workspace.id === state.activeWorkspace.id) { setOpen(false); return; }
    setBusy(true); setError(null);
    try {
      await apiRequest("/api/workspaces", { method: "PATCH", body: JSON.stringify({ action: "switch", workspaceId: workspace.id }) });
      setOpen(false);
      await onRefresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not switch workspaces."); }
    finally { setBusy(false); }
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      await apiRequest("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          eventDate: form.get("eventDate") || null,
          location: form.get("location") || null,
          goal: form.get("goal") || null
        })
      });
      setDialog(null); setOpen(false);
      await onRefresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create the workspace."); }
    finally { setBusy(false); }
  }

  async function remove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      await apiRequest("/api/workspaces", {
        method: "DELETE",
        body: JSON.stringify({ workspaceId: active.id, confirmationName: form.get("confirmationName") })
      });
      setDialog(null); setOpen(false);
      await onRefresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete the workspace."); }
    finally { setBusy(false); }
  }

  return <div className="workspace-switcher" ref={root}>
    <button className="brand workspace-brand" type="button" aria-haspopup="menu" aria-expanded={open} aria-label={active ? `Open workspace menu for ${active.name}` : "Open workspace menu"} onClick={() => { setError(null); setOpen((value) => !value); }} disabled={!state}>
      <span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>
      <span className="brand-copy"><strong>Marketing Hub</strong><small>{active ? `${active.name} workspace` : "Opening workspace…"}</small></span>
      <ChevronDown className="workspace-brand-chevron" size={15} aria-hidden="true"/>
    </button>

    {open && state && <div className="workspace-menu" role="menu" aria-label="Workspaces">
      <div className="workspace-menu-heading"><span>Workspaces</span><small>{state.workspaces.length} on this device</small></div>
      <div className="workspace-menu-list">
        {state.workspaces.map((workspace) => <button key={workspace.id} type="button" role="menuitemradio" aria-checked={workspace.id === active?.id} className={workspace.id === active?.id ? "workspace-menu-item active" : "workspace-menu-item"} onClick={() => void select(workspace)} disabled={busy}>
          <span className="workspace-menu-icon"><LayoutGrid size={15}/></span>
          <span><strong>{workspace.name}</strong><small>{workspace.location || workspace.eventDate || "Summit workspace"}</small></span>
          {workspace.id === active?.id && <Check size={15} aria-label="Current workspace"/>}
        </button>)}
      </div>
      {error && <p className="workspace-inline-error" role="alert">{error}</p>}
      <div className="workspace-menu-actions">
        <button type="button" onClick={() => { setDialog("create"); setOpen(false); setError(null); }}><Plus size={15}/>New workspace</button>
        <button type="button" className="danger-text" disabled={state.workspaces.length <= 1} title={state.workspaces.length <= 1 ? "Keep at least one workspace" : `Delete ${active?.name}`} onClick={() => { setConfirmationName(""); setDialog("delete"); setOpen(false); setError(null); }}><Trash2 size={15}/>Delete workspace</button>
      </div>
    </div>}

    {dialog === "create" && <WorkspaceDialog title="Create a summit workspace" eyebrow="New workspace" onClose={() => !busy && setDialog(null)}>
      <form className="workspace-create-form" onSubmit={create}>
        <p className="workspace-dialog-intro">Start with the details that identify this summit. Context, creative assets, and campaign work stay separate from every other workspace.</p>
        <label>Workspace name<input autoFocus name="name" required minLength={2} maxLength={80} placeholder="e.g. Applied Intelligence Forum"/></label>
        <div className="workspace-form-row"><label>Event date <span>Optional</span><input name="eventDate" type="date"/></label><label>Location <span>Optional</span><input name="location" maxLength={120} placeholder="City or venue"/></label></div>
        <label>Primary goal <span>Optional</span><textarea name="goal" rows={3} maxLength={500} placeholder="What should this marketing program accomplish?"/></label>
        {error && <p className="workspace-dialog-error" role="alert">{error}</p>}
        <div className="workspace-dialog-actions"><button className="button secondary" type="button" onClick={() => setDialog(null)} disabled={busy}>Cancel</button><button className="button" disabled={busy}>{busy ? "Creating…" : "Create workspace"}</button></div>
      </form>
    </WorkspaceDialog>}

    {dialog === "delete" && active && <WorkspaceDialog title={`Delete ${active.name}?`} eyebrow="Permanent deletion" tone="danger" onClose={() => !busy && setDialog(null)}>
      <form className="workspace-delete-form" onSubmit={remove}>
        <p>This permanently removes this workspace’s context, assets, research, campaigns, Speaker Spotlight runs, agenda, and activity. Other workspaces are not affected.</p>
        <label>Type <strong>{active.name}</strong> to confirm<input autoFocus name="confirmationName" required autoComplete="off" value={confirmationName} onChange={(event) => setConfirmationName(event.target.value)}/></label>
        {error && <p className="workspace-dialog-error" role="alert">{error}</p>}
        <div className="workspace-dialog-actions"><button className="button secondary" type="button" onClick={() => setDialog(null)} disabled={busy}>Cancel</button><button className="button danger-button" disabled={busy || confirmationName !== active.name}>{busy ? "Deleting…" : "Delete workspace"}</button></div>
      </form>
    </WorkspaceDialog>}
  </div>;
}

function WorkspaceDialog({ title, eyebrow, tone = "default", onClose, children }: { title: string; eyebrow: string; tone?: "default" | "danger"; onClose: () => void; children: React.ReactNode }) {
  return <div className={`workspace-dialog ${tone}`} role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title">
    <button className="workspace-dialog-backdrop" aria-label="Close dialog" onClick={onClose}/>
    <div className="workspace-dialog-panel">
      <div className="workspace-dialog-heading"><div><span className="eyebrow">{eyebrow}</span><h2 id="workspace-dialog-title">{title}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={17}/></button></div>
      {children}
    </div>
  </div>;
}

export function WorkspaceGuide({ state, onRefresh }: { state: WorkspaceState; onRefresh: () => Promise<void> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspace = state.activeWorkspace;
  if (workspace.onboardingDismissedAt) return null;

  async function dismiss(destination?: string) {
    setBusy(true); setError(null);
    try {
      await apiRequest("/api/workspaces", { method: "PATCH", body: JSON.stringify({ action: "dismiss_guide", workspaceId: workspace.id }) });
      await onRefresh();
      if (destination) router.push(destination);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not close the guide."); }
    finally { setBusy(false); }
  }

  const details = [workspace.eventDate, workspace.location].filter(Boolean).join(" · ");
  return <div className="workspace-guide" role="dialog" aria-modal="true" aria-labelledby="workspace-guide-title">
    <div className="workspace-guide-backdrop"/>
    <div className="workspace-guide-panel">
      <div className="workspace-guide-hero"><span className="workspace-guide-mark"><Check size={22}/></span><div><span className="eyebrow">Workspace ready</span><h2 id="workspace-guide-title">Set up {workspace.name}</h2><p>{details || "Your new summit workspace is empty and ready for its own campaign context."}</p></div></div>
      <p className="workspace-guide-copy">Add these inputs before generating marketing work. You can start small and return to the Context library whenever details change.</p>
      <div className="workspace-guide-grid">
        <GuideItem icon={<BookOpenText/>} title="Event essentials" copy="Event overview, dates, venue, website, registration link, and the facts that must never change."/>
        <GuideItem icon={<ImageIcon/>} title="Brand and voice" copy="Logos, approved artwork, brand voice, visual references, and strong examples of finished content."/>
        <GuideItem icon={<Target/>} title="Audience and channels" copy="Priority audiences, desired action, campaign positioning, and platform-specific writing guidance."/>
        <GuideItem icon={<UsersRound/>} title="Program inputs" copy="Speaker names and headshots, partner details, and the final agenda or session information when available."/>
      </div>
      {workspace.goal && <div className="workspace-guide-goal"><Target size={15}/><span><strong>Primary goal</strong>{workspace.goal}</span></div>}
      {error && <p className="workspace-dialog-error" role="alert">{error}</p>}
      <div className="workspace-guide-actions"><button className="button secondary" disabled={busy} onClick={() => void dismiss()}>{busy ? "Saving…" : "I’ll do this later"}</button><button className="button" disabled={busy} onClick={() => void dismiss("/context")}>Open Context<ArrowRight size={15}/></button></div>
    </div>
  </div>;
}

function GuideItem({ icon, title, copy }: { icon: React.ReactNode; title: string; copy: string }) {
  return <div className="workspace-guide-item"><span>{icon}</span><div><strong>{title}</strong><p>{copy}</p></div></div>;
}
