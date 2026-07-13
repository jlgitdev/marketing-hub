/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ContextDocument } from "@/lib/types";
import { ContextPicker } from "@/components/context-picker";

const documents: ContextDocument[] = [
  { id: "00000000-0000-4000-8000-000000000001", title: "Event brief", type: "event_brief", body: "event facts", active: true, sourceOfTruth: true, notes: "", createdAt: "2026-07-12", updatedAt: "2026-07-12" },
  { id: "00000000-0000-4000-8000-000000000002", title: "Audience", type: "target_audience", body: "builders and researchers", active: true, sourceOfTruth: false, notes: "", createdAt: "2026-07-12", updatedAt: "2026-07-12" },
  { id: "00000000-0000-4000-8000-000000000003", title: "Voice", type: "brand_voice", body: "calm and practical", active: true, sourceOfTruth: false, notes: "", createdAt: "2026-07-12", updatedAt: "2026-07-12" }
].map((document) => ({ ...document, summary: document.body, tags: [], platforms: [], purposes: ["content"], origin: "user" as const, sourcePath: null, contentHash: null }));

describe("AI context preflight", () => {
  it("defaults to automatic selection and preserves manual override controls", () => {
    render(<ContextPicker documents={documents}/>);
    expect(screen.getByText(/3 active documents available for automatic ranking/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Automatic relevance selection/ }));
    expect(screen.getByText(/3 selected/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Audience/ }));
    expect(screen.getByText(/2 selected/)).toBeInTheDocument();
  });
});
