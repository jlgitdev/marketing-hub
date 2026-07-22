"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, BookOpenText, CheckCircle2, ContactRound, FileClock, KeyRound, MicVocal, PenLine } from "lucide-react";
import { cleanCampaignName, ConnectionBadge, PageState, formatDate, useWorkspace } from "./workspace";
import { ConnectionTestProgress } from "./operations";

export function DashboardClient() {
  const workspace = useWorkspace();
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  if (!workspace.state) return <PageState loading={workspace.loading} error={workspace.error} retry={workspace.refresh}/>;
  const state = workspace.state;
  const hasEventBrief = state.contextDocuments.some((document) => document.active && (document.sourceOfTruth || document.type === "event_information" || /event/i.test(document.type)));
  const hasAudience = state.contextDocuments.some((document) => document.active && (document.type === "target_audience" || document.tags.includes("audience")));
  const latestRun = state.researchRuns[0];
  const latestCampaign = state.contentCampaigns[0];
  const latestUsableCampaign = state.contentCampaigns.find((campaign) => campaign.status !== "failed");
  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setConnecting(true); setConnectionMessage(null); const formElement = event.currentTarget; const form = new FormData(formElement);
    try { await fetch("/api/settings/key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: form.get("apiKey") }) }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Connection failed."); }); formElement.reset(); setConnectionMessage("OpenAI connected. The key is held only in backend memory."); await workspace.refresh(); }
    catch (error) { setConnectionMessage(error instanceof Error ? error.message : "Connection failed."); } finally { setConnecting(false); }
  }
  const actions = [
    !state.connection.connected && { icon: KeyRound, title: "Connect OpenAI", detail: "Use a temporary key for live research and generation.", href: "/settings", action: "Open settings" },
    !hasEventBrief && { icon: BookOpenText, title: "Add an event brief", detail: "Give every workflow an approved source for dates, location, and ticket details.", href: "/context", action: "Add context" },
    hasEventBrief && !hasAudience && { icon: BookOpenText, title: "Describe the target audience", detail: "Improve opportunity fit and platform copy with one active audience guide.", href: "/context", action: "Add audience" },
    state.counts.awaitingReview > 0 && { icon: CheckCircle2, title: `Review ${state.counts.awaitingReview} opportunities`, detail: "Inspect supporting evidence before outreach or export.", href: "/leads", action: "Review leads" },
    hasEventBrief && { icon: ContactRound, title: "Find Bay Area opportunities", detail: "Research organizations, communities, schools, and upcoming events.", href: "/leads", action: "Find opportunities" },
    hasEventBrief && { icon: PenLine, title: latestUsableCampaign ? "Continue the latest campaign" : latestCampaign?.status === "failed" ? "Review the failed content run" : "Turn the event brief into social posts", detail: latestUsableCampaign ? `${cleanCampaignName(latestUsableCampaign.name)} has ${latestUsableCampaign.posts.length} saved platform draft${latestUsableCampaign.posts.length === 1 ? "" : "s"}.` : latestCampaign?.status === "failed" ? `${cleanCampaignName(latestCampaign.name)} remains inspectable and did not replace earlier work.` : "Create distinct copy for X, LinkedIn, and Instagram.", href: latestUsableCampaign ? `/content?campaign=${latestUsableCampaign.id}` : latestCampaign ? `/content?campaign=${latestCampaign.id}` : "/content", action: latestUsableCampaign ? "Open campaign" : latestCampaign?.status === "failed" ? "Inspect failure" : "Create content" }
    ,hasEventBrief && { icon: MicVocal, title: "Create Speaker Spotlights", detail: "Turn a list of AGI Summit speaker names into verified 2:3 editorial posters and cross-platform captions.", href: "/speaker-spotlight", action: "Open Speaker Spotlight" }
  ].filter(Boolean).slice(0, 5) as Array<{ icon: typeof KeyRound; title: string; detail: string; href: string; action: string }>;

  return <div className="page">
    <header className="page-header split">
      <div><h1>Overview</h1><p className="lede">Source-backed opportunity research, review-ready outreach, and campaign content in one local workspace.</p></div>
      <ConnectionBadge state={state}/>
    </header>
    {!state.connection.connected && !state.demoMode && <section className="quick-connect"><div><KeyRound size={19}/><span><strong>Connect OpenAI to use live research and generation</strong><small>The raw key stays in backend process memory and disappears on server exit.</small></span></div><form onSubmit={connect}><label className="sr-only" htmlFor="dashboard-api-key">OpenAI API key</label><input id="dashboard-api-key" name="apiKey" type="password" autoComplete="off" required placeholder="sk-…"/><button className="button" disabled={connecting}>{connecting ? "Testing…" : "Connect and test"}</button></form><ConnectionTestProgress active={connecting}/><small className="credit-note">The explicit connection test makes a small billable API request.</small>{connectionMessage && <p role="status">{connectionMessage}</p>}</section>}
    <section className="metric-grid overview-metrics" aria-label="Workspace summary">
      <div className="metric"><strong>{state.counts.activeContext}</strong><small>active context documents</small></div>
      <div className="metric"><strong>{state.counts.leads}</strong><small>saved opportunities</small></div>
      <div className="metric"><strong>{state.counts.awaitingReview}</strong><small>awaiting review</small></div>
      <div className="metric"><strong>{state.counts.campaigns}</strong><small>content campaigns</small></div>
    </section>
    <section className="section-block"><div className="section-heading"><h2>Recommended next steps</h2></div><div className="grid two">{actions.map(({ icon: Icon, ...action }) => <Link className="action-card" href={action.href} key={action.title}><span className="icon-box"><Icon size={20}/></span><span className="action-copy"><strong>{action.title}</strong><small>{action.detail}</small><span className="text-link">{action.action}<ArrowRight size={15}/></span></span></Link>)}</div></section>
    <section className="grid two section-block">
      <div className="panel"><div className="panel-heading"><h2>Latest research run</h2><Link href="/runs" className="subtle-link">View all</Link></div>{latestRun ? <div className="run-row"><span className={`status-icon ${latestRun.status}`}><FileClock size={18}/></span><div><strong>{latestRun.name}</strong><p>{latestRun.resultCount} results · {latestRun.region}</p><small>{formatDate(latestRun.startedAt)} · {latestRun.status.replaceAll("_", " ")}</small></div><Link href="/leads" className="button secondary small">Open</Link></div> : <Empty icon={ContactRound} title="No research yet" text="Run a deterministic demo search or connect OpenAI for live web research." href="/leads"/>}</div>
      <div className="panel"><div className="panel-heading"><h2>Latest campaign</h2><Link href="/runs" className="subtle-link">View all</Link></div>{latestCampaign ? <div className="run-row"><span className={`status-icon ${latestCampaign.status}`}><PenLine size={18}/></span><div><strong>{cleanCampaignName(latestCampaign.name)}</strong><p>{latestCampaign.status === "failed" ? "Generation failed · inspect the saved error" : latestCampaign.posts.map((post) => post.platform === "x" ? "X" : post.platform === "general" ? "Any platform" : post.platform[0].toUpperCase()+post.platform.slice(1)).join(" · ")}</p><small>Updated {formatDate(latestCampaign.updatedAt)}</small></div><Link href={`/content?campaign=${latestCampaign.id}`} className="button secondary small">Open</Link></div> : <Empty icon={PenLine} title="No campaign yet" text="Transform selected guides into distinct platform drafts and a campaign graphic." href="/content"/>}</div>
    </section>
  </div>;
}

function Empty({ icon: Icon, title, text, href }: { icon: typeof PenLine; title: string; text: string; href: string }) {
  return <div className="compact-empty"><Icon size={22}/><div><strong>{title}</strong><p>{text}</p></div><Link href={href} className="text-link">Get started<ArrowRight size={15}/></Link></div>;
}
