"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenText, CalendarDays, ContactRound, FileClock, Home, MessageCircleMore, MicVocal, PenLine, Settings } from "lucide-react";
import { WorkspaceProvider, useWorkspace } from "./workspace";
import { OperationsProvider } from "./operations";
import { WorkspaceGuide, WorkspaceSwitcher } from "./workspace-switcher";

const nav = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/assistant", label: "Assistant", icon: MessageCircleMore },
  { href: "/context", label: "Context", icon: BookOpenText },
  { href: "/leads", label: "Leads", icon: ContactRound },
  { href: "/content", label: "Content", icon: PenLine },
  { href: "/speaker-spotlight", label: "Spotlight", icon: MicVocal },
  { href: "/summit-agenda", label: "Live Agenda", icon: CalendarDays },
  { href: "/runs", label: "Runs", icon: FileClock },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return <WorkspaceProvider><WorkspaceRuntime>{children}</WorkspaceRuntime></WorkspaceProvider>;
}

function WorkspaceRuntime({ children }: { children: React.ReactNode }) {
  const workspace = useWorkspace();
  const workspaceId = workspace.state?.activeWorkspace.id || "opening";
  return <OperationsProvider key={workspaceId}><AppFrame>{children}</AppFrame></OperationsProvider>;
}

function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const workspace = useWorkspace();
  const demoMode = Boolean(workspace.state?.demoMode);
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <WorkspaceSwitcher state={workspace.state} onRefresh={workspace.refresh}/>
        <span className="nav-label">Workspace</span>
        <nav aria-label="Primary navigation">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return <Link key={item.href} href={item.href} aria-label={item.label} aria-current={active ? "page" : undefined} className={active ? "nav-link active" : "nav-link"}><Icon size={18} aria-hidden="true"/><span>{item.label}</span></Link>;
          })}
        </nav>
        <div className="sidebar-footer">
          <span className="sidebar-footer-label">Private workspace</span>
          {demoMode && <p className="local-note demo"><span className="local-dot"/>Demo data — no external requests</p>}
          <p className="local-note"><span className="local-dot"/>All data stays on this device</p>
        </div>
      </aside>
      <main className="main-content">{children}</main>
      {workspace.state && <WorkspaceGuide state={workspace.state} onRefresh={workspace.refresh}/>}
    </div>
  );
}
