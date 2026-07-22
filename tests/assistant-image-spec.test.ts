import { describe, expect, it } from "vitest";
import { resolveAssistantImageSpec } from "@/server/services/assistant-image-spec";

describe("Assistant GPT Image 2 sizing", () => {
  it("preserves supported user ratios ahead of planner and platform defaults", () => {
    expect(resolveAssistantImageSpec("Create a 9:16 story graphic", "1:1", "instagram")).toMatchObject({
      width: 864,
      height: 1536,
      size: "864x1536",
      aspectRatio: "9:16",
      notes: []
    });
  });

  it("normalizes exact dimensions to current GPT Image 2 constraints without a retry", () => {
    const spec = resolveAssistantImageSpec("Use exactly 1080 × 1920 pixels", "1:1", "general");
    expect(spec).toMatchObject({ width: 1088, height: 1920, size: "1088x1920" });
    expect(spec.notes).toHaveLength(1);
  });

  it("clamps unsupported extreme ratios and returns a helpful note", () => {
    const spec = resolveAssistantImageSpec("Make it 5:1", "1:1", "general");
    expect(spec.width / spec.height).toBeLessThanOrEqual(3);
    expect(spec.notes.join(" ")).toMatch(/supports ratios up to 3:1/i);
  });

  it("does not misread event times as aspect ratios", () => {
    expect(resolveAssistantImageSpec("The session runs at 9:16 AM", "4:5", "general")).toMatchObject({ aspectRatio: "4:5" });
  });
});
