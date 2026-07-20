/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocumentPreview } from "@/components/context-client";

describe("deferred frontend work", () => {
  it("does not parse or mount Markdown until its preview is opened", async () => {
    const { container } = render(<DocumentPreview body={"# Deferred heading\n\nA long context document."}/>);
    expect(screen.queryByRole("heading", { name: "Deferred heading" })).not.toBeInTheDocument();

    const details = container.querySelector("details")!;
    fireEvent.click(screen.getByText("Preview"));
    expect(details.open).toBe(true);
    expect(await screen.findByRole("heading", { name: "Deferred heading" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Preview"));
    expect(details.open).toBe(false);
    expect(screen.getByRole("heading", { name: "Deferred heading" })).toBeInTheDocument();
  });
});
