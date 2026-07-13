import { describe, expect, it } from "vitest";
import { PLATFORM_CONFIG } from "@/lib/config";
import { escapeXml } from "@/server/security/validation";
import { buildOverlaySvg, wrapText } from "@/server/storage/assets";

describe("centralized platform and image rules", () => {
  it("keeps character limits and image dimensions in one typed configuration", () => {
    expect(PLATFORM_CONFIG.x.characterLimit).toBe(280);
    expect(PLATFORM_CONFIG.linkedin.image.width).toBeGreaterThan(1000);
    expect(PLATFORM_CONFIG.instagram.image.width).toBe(PLATFORM_CONFIG.instagram.image.height);
  });
  it("escapes untrusted overlay text before SVG composition", () => {
    expect(escapeXml(`<script>alert("x")</script>`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });
  it("wraps overlay headlines and splits long unbroken words within the safe width", () => {
    expect(wrapText("Applied Intelligence Forum", 20)).toEqual(["Applied Intelligence", "Forum"]);
    expect(wrapText("averylongunbrokenheadline", 10)).toEqual(["averylongu", "nbrokenhea", "dline"]);
  });
  it("keeps every application-controlled overlay field in the rendered SVG contract", () => {
    const svg = buildOverlaySvg(1080, 1080, "Applied Intelligence Forum", "October 14 · Pier 27", "Save the date and explore the program");
    expect(svg).toContain("Applied Intelligence");
    expect(svg).toContain("Forum");
    expect(svg).toContain("October 14 · Pier 27");
    expect(svg).toContain("Save the date and explore the program");
  });
});
