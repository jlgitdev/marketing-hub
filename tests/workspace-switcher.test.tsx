/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceState, WorkspaceSummary } from "@/lib/types";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("@/components/workspace", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/workspace")>();
  return { ...original, apiRequest: mocks.apiRequest };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

import { WorkspaceGuide, WorkspaceSwitcher } from "@/components/workspace-switcher";

const current: WorkspaceSummary = {
  id: "default",
  name: "AGI Summit",
  eventDate: null,
  location: "San Francisco",
  goal: "Promote the summit",
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
  lastOpenedAt: "2026-07-20T00:00:00.000Z",
  onboardingDismissedAt: "2026-07-20T00:00:00.000Z"
};

const second: WorkspaceSummary = {
  ...current,
  id: "00000000-0000-4000-8000-000000000002",
  name: "Robotics Forum",
  location: "Oakland",
  onboardingDismissedAt: null
};

function workspaceState(activeWorkspace = current): WorkspaceState {
  return {
    activeWorkspace,
    workspaces: [activeWorkspace, activeWorkspace.id === current.id ? second : current],
    demoMode: true,
    dataPath: "/tmp/workspace",
    connection: { connected: true, source: "demo", suffix: null, state: "connected", message: "Demo" },
    contextDocuments: [],
    brandAssets: [],
    researchRuns: [],
    leads: [],
    outreachCampaigns: [],
    contentCampaigns: [],
    speakerSpotlightTemplates: [],
    speakerSpotlightBatches: [],
    summitAgendaBatches: [],
    counts: { activeContext: 0, leads: 0, awaitingReview: 0, campaigns: 0, speakerSpotlightTemplates: 0, speakerSpotlights: 0, summitAgendaPosts: 0 }
  };
}

beforeEach(() => {
  mocks.apiRequest.mockReset();
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.apiRequest.mockResolvedValue({ workspace: second });
  mocks.refresh.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("workspace controls", () => {
  it("opens from the Marketing Hub brand and switches to another workspace", async () => {
    render(<WorkspaceSwitcher state={workspaceState()} onRefresh={mocks.refresh}/>);
    fireEvent.click(screen.getByRole("button", { name: /Open workspace menu for AGI Summit/ }));
    expect(screen.getByRole("menu", { name: "Workspaces" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Robotics Forum/ }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("/api/workspaces", expect.objectContaining({ method: "PATCH", body: expect.stringContaining(second.id) })));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("collects only the essential details when creating a summit workspace", async () => {
    render(<WorkspaceSwitcher state={workspaceState()} onRefresh={mocks.refresh}/>);
    fireEvent.click(screen.getByRole("button", { name: /Open workspace menu/ }));
    fireEvent.click(screen.getByRole("button", { name: "New workspace" }));
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Applied Intelligence Forum" } });
    fireEvent.change(screen.getByLabelText(/Location/), { target: { value: "San Jose" } });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("/api/workspaces", expect.objectContaining({ method: "POST", body: expect.stringContaining("Applied Intelligence Forum") })));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("requires the active workspace name before deletion can be submitted", async () => {
    render(<WorkspaceSwitcher state={workspaceState()} onRefresh={mocks.refresh}/>);
    fireEvent.click(screen.getByRole("button", { name: /Open workspace menu/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete workspace" }));
    const deleteButton = screen.getByRole("button", { name: "Delete workspace" });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type AGI Summit to confirm/), { target: { value: "AGI Summit" } });
    expect(deleteButton).toBeEnabled();
    fireEvent.click(deleteButton);
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("/api/workspaces", expect.objectContaining({ method: "DELETE", body: expect.stringContaining("AGI Summit") })));
  });

  it("shows the setup checklist once and can take the user directly to Context", async () => {
    render(<WorkspaceGuide state={workspaceState(second)} onRefresh={mocks.refresh}/>);
    expect(screen.getByRole("dialog", { name: /Set up Robotics Forum/ })).toBeInTheDocument();
    expect(screen.getByText("Event essentials")).toBeInTheDocument();
    expect(screen.getByText("Brand and voice")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open Context/ }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("/api/workspaces", expect.objectContaining({ method: "PATCH", body: expect.stringContaining("dismiss_guide") })));
    expect(mocks.push).toHaveBeenCalledWith("/context");
  });
});
