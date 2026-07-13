"use client";

import { useState } from "react";
import { Database, HardDrive, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { apiRequest, ConnectionBadge, PageState, useWorkspace } from "./workspace";
import { ConnectionTestProgress } from "./operations";

export function SettingsClient() {
  const workspace = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (!workspace.state) return <PageState loading={workspace.loading} error={workspace.error} retry={workspace.refresh}/>;
  const state = workspace.state;

  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("key"); setMessage(null); const formElement = event.currentTarget; const form = new FormData(formElement);
    try { await apiRequest("/api/settings/key", { method: "POST", body: JSON.stringify({ apiKey: form.get("apiKey") }) }); formElement.reset(); setMessage("OpenAI connection tested. The raw key is held only in backend process memory."); await workspace.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Connection failed."); } finally { setBusy(null); }
  }
  async function disconnect() {
    setBusy("key"); try { await apiRequest("/api/settings/key", { method: "DELETE" }); setMessage(state.connection.source === "environment" ? "No temporary session existed. Remove OPENAI_API_KEY from the launching environment to disconnect the environment key." : "Temporary key session cleared from backend memory."); await workspace.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Disconnect failed."); } finally { setBusy(null); }
  }
  async function reset() {
    const first = confirm("Reset all Marketing Hub data? This removes every context document, uploaded visual, research run, lead, outreach campaign, social campaign, and generated image inside the configured data directory. It does not remove environment variables or files outside that directory.");
    if (!first) return;
    const phrase = prompt("Type RESET MARKETING HUB to confirm.");
    if (phrase !== "RESET MARKETING HUB") return setMessage("Reset canceled; confirmation phrase did not match.");
    setBusy("reset"); try { await apiRequest("/api/reset", { method: "POST", body: JSON.stringify({ confirm: true }) }); setMessage("All local Marketing Hub records and assets were removed."); await workspace.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Reset failed."); } finally { setBusy(null); }
  }

  return <div className="page"><header className="page-header split"><div><h1>Settings</h1><p className="lede">Marketing Hub runs on loopback. Context leaves this device only when you explicitly start an OpenAI operation.</p></div><ConnectionBadge state={state}/></header>
    {message && <div className={message.toLowerCase().includes("failed") ? "notice danger" : "notice"} role="status">{message}</div>}
    <div className="settings-grid"><section className="panel"><div className="panel-heading"><span className="icon-box"><KeyRound/></span><div><h2>OpenAI connection</h2><p className="muted">{state.connection.connected ? "Connected" : "Temporary API key"}</p></div></div>{state.demoMode ? <div className="callout"><ShieldCheck/><div><strong>Demo provider is active</strong><p>No key is needed. Demo actions are deterministic and make no external requests.</p></div></div> : state.connection.connected ? <div className="form-stack"><div className="connection-detail"><span>Connection source</span><strong>{state.connection.source === "environment" ? "OPENAI_API_KEY environment variable" : `Temporary session ••••${state.connection.suffix}`}</strong></div><p>{state.connection.message}</p><button className="button secondary" onClick={() => void disconnect()} disabled={busy === "key"}>{busy === "key" ? "Disconnecting…" : "Disconnect temporary key"}</button></div> : <form className="form-stack" onSubmit={connect}><label>OpenAI API key<input name="apiKey" type="password" autoComplete="off" spellCheck="false" required placeholder="sk-…"/></label><button className="button" disabled={busy === "key"}>{busy === "key" ? "Testing connection…" : "Connect and test"}</button><small>This explicit test makes a small billable Responses request. Usage is charged to the key owner.</small></form>}<ConnectionTestProgress active={busy === "key" && !state.connection.connected}/><div className="privacy-list"><span><ShieldCheck/>Browser never calls OpenAI directly</span><span><ShieldCheck/>Raw key is never stored in files or SQLite</span><span><ShieldCheck/>Opaque HttpOnly cookie only</span><span><ShieldCheck/>Session expires and disappears on server exit</span></div></section>
      <section className="panel"><div className="panel-heading"><span className="icon-box"><HardDrive/></span><div><h2>Local data directory</h2></div></div><div className="path-box"><Database size={17}/><code>{state.dataPath}</code></div><p>SQLite, uploaded images, generated graphics, exports, and temporary composition files stay under this ignored directory.</p><div className="data-summary"><span><strong>{state.contextDocuments.length}</strong>context documents</span><span><strong>{state.brandAssets.length}</strong>brand assets</span><span><strong>{state.researchRuns.length}</strong>research runs</span><span><strong>{state.contentCampaigns.length}</strong>content campaigns</span></div><div className="danger-zone"><h3>Reset this workspace</h3><p>Deletes all Marketing Hub records and assets inside the configured data directory. It never deletes files outside that directory.</p><button className="button danger-button" onClick={() => void reset()} disabled={busy === "reset"}><Trash2 size={16}/>{busy === "reset" ? "Resetting…" : "Reset all local data"}</button></div></section>
    </div>
  </div>;
}
