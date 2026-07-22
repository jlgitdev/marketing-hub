import { describe, expect, it } from "vitest";
import { PLATFORM_CONFIG } from "@/lib/config";

describe("centralized platform and image rules", () => {
  it("keeps character limits and image dimensions in one typed configuration", () => {
    expect(PLATFORM_CONFIG.x.characterLimit).toBe(280);
    expect(PLATFORM_CONFIG.linkedin.image.width).toBeGreaterThan(1000);
    expect(PLATFORM_CONFIG.instagram.image.width).toBe(PLATFORM_CONFIG.instagram.image.height);
  });
  it("keeps platform constraints separate from the full-artwork image renderer", () => {
    expect(Object.keys(PLATFORM_CONFIG)).toEqual(["general", "x", "linkedin", "instagram"]);
    expect(PLATFORM_CONFIG.general.characterLimit).toBeGreaterThan(PLATFORM_CONFIG.linkedin.characterLimit);
  });
});
