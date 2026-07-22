import { describe, expect, it } from "vitest";
import { isSafeApplicationOrigin } from "@/server/security/request";

describe("state-changing request origin validation", () => {
  it("accepts only the exact loopback host and port", () => {
    expect(isSafeApplicationOrigin("http://127.0.0.1:3200", "127.0.0.1:3200")).toBe(true);
    expect(isSafeApplicationOrigin("http://localhost:3000", "localhost:3000")).toBe(true);
    expect(isSafeApplicationOrigin("http://[::1]:3000", "[::1]:3000")).toBe(true);

    expect(isSafeApplicationOrigin("http://127.0.0.1:9999", "127.0.0.1:3200")).toBe(false);
    expect(isSafeApplicationOrigin("http://localhost:9999", "localhost:3000")).toBe(false);
    expect(isSafeApplicationOrigin("https://example.com", "127.0.0.1:3200")).toBe(false);
    expect(isSafeApplicationOrigin("null", "127.0.0.1:3200")).toBe(false);
    expect(isSafeApplicationOrigin("http://127.0.0.1:3200", null)).toBe(false);
    expect(isSafeApplicationOrigin("http://127.0.0.1:3200", "127.0.0.1:3200", "https://127.0.0.1:3200")).toBe(false);
    expect(isSafeApplicationOrigin("http://127.0.0.1:3200", "127.0.0.1:3200", "http://127.0.0.1:3200/api/assistant")).toBe(true);
  });
});
