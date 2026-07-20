/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiOperation } from "@/lib/types";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), refresh: vi.fn() }));
vi.mock("@/components/workspace", () => ({
  apiRequest: mocks.apiRequest,
  useWorkspace: () => ({ refresh: mocks.refresh })
}));

import { InlineOperation, OperationsProvider } from "@/components/operations";

const operation: AiOperation = {
  id: "00000000-0000-4000-8000-000000000010", kind: "research", label: "Bay Area opportunity scan", status: "running",
  steps: [
    { id: "preparing", label: "Prepare request", detail: null, state: "completed" },
    { id: "researching", label: "Research public sources", detail: "Searching official public pages with OpenAI.", state: "active" },
    { id: "saving", label: "Save opportunities", detail: null, state: "pending" }
  ],
  completedUnits: null, totalUnits: null, unitLabel: null, resultEntityType: null, resultEntityId: null, resultHref: null,
  originPath: "/leads", targetKey: "research:test", error: null, retryable: false,
  createdAt: "2026-07-12T12:00:00.000Z", startedAt: "2026-07-12T12:00:01.000Z", updatedAt: "2026-07-12T12:00:02.000Z", completedAt: null
};

beforeEach(() => {
  mocks.apiRequest.mockReset();
  mocks.refresh.mockReset();
  mocks.apiRequest.mockImplementation((url: string, init?: RequestInit) => {
    if (url.startsWith("/api/operations?") && !init?.method) return Promise.resolve({ operations: [operation] });
    if (init?.method === "DELETE") return Promise.resolve({ operation: { ...operation, status: "cancel_requested" } });
    if (url === "/api/operations" && init?.method === "PATCH") return Promise.resolve({ operation: { ...operation, status: "failed" }, dismissed: true });
    return Promise.resolve({ operations: [operation] });
  });
});

describe("AI progress components", () => {
  it("announces real stage changes, keeps the elapsed timer decorative, and offers cancellation", async () => {
    render(<OperationsProvider><InlineOperation operation={operation}/></OperationsProvider>);
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Research public sources");
    expect(screen.getByText("Searching official public pages with OpenAI.")).toBeInTheDocument();
    expect(screen.getByText(/move to another screen/i)).toBeInTheDocument();
    expect(document.querySelector(".operation-elapsed")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(expect.stringContaining("/api/operations?id="), expect.objectContaining({ method: "DELETE" })));
  });

  it("renders factual countable progress for composite work", () => {
    render(<OperationsProvider><InlineOperation operation={{ ...operation, kind: "content_regenerate", completedUnits: 2, totalUnits: 3, unitLabel: "platforms" }}/></OperationsProvider>);
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    expect(screen.getByText(/platforms processed/)).toBeInTheDocument();
  });

  it("does not reload the full workspace while Spotlight progress is polled", async () => {
    mocks.apiRequest.mockResolvedValue({ operations: [{ ...operation, kind: "spotlight_batch", originPath: "/speaker-spotlight" }] });
    render(<OperationsProvider><div>Speaker workspace</div></OperationsProvider>);

    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("/api/operations?limit=20", expect.objectContaining({ cache: "no-store" })));
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("clearly marks terminal work as stopped and dismisses it from recent activity", async () => {
    const failed = { ...operation, status: "failed" as const, completedAt: "2026-07-12T12:00:01.500Z", error: "A verified headshot was not found.", retryable: true };
    render(<OperationsProvider><InlineOperation operation={failed}/></OperationsProvider>);
    expect(screen.getByText("Stopped with an issue")).toBeInTheDocument();
    expect(screen.getByText(/no longer running/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `Dismiss ${failed.label}` }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("/api/operations", expect.objectContaining({ method: "PATCH" })));
  });

  it("keeps background polling failures out of the runtime error overlay and offers recovery", async () => {
    mocks.apiRequest.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<OperationsProvider><div>Workspace content</div></OperationsProvider>);

    expect(await screen.findByText("Local server unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /local server unavailable/i }));
    expect(screen.getByText("Failed to fetch")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    await waitFor(() => expect(screen.queryByText("Local server unavailable")).not.toBeInTheDocument());
  });
});
