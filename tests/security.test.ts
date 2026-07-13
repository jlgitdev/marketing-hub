import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CONTEXT_CHARS } from "@/lib/config";
import { dataDirectory } from "@/server/config";
import { isPathInsideDataDirectory } from "@/server/config";
import { clearKeySession, connectionStatus, createKeySession, createValidatedKeySession, resetKeyStoreForTests, resolveApiKey, sessionCountForTests } from "@/server/security/key-store";
import { assertContextSize, emailDomain, emailSchema, escapeCsvCell, isConsumerEmail, normalizeEmail, redactSecrets, safeFileName, validateAssetUpload, validatePublicSourceUrl, validateTextUpload } from "@/server/security/validation";

beforeEach(() => resetKeyStoreForTests());

describe("API key memory sessions", () => {
  it("returns only an opaque id and suffix, never the raw key", () => {
    const raw = "sk-test-super-secret-value-1234";
    const session = createKeySession(raw);
    expect(JSON.stringify(session)).not.toContain(raw);
    expect(session.id).not.toContain(raw);
    expect(session.suffix).toBe("1234");
    expect(resolveApiKey(session.id)?.key).toBe(raw);
    const status = connectionStatus(session.id);
    expect(JSON.stringify(status)).not.toContain(raw);
  });

  it("connects through an injected mock validator without returning the raw key", async () => {
    vi.stubEnv("MARKETING_HUB_DEMO_MODE", "false");
    const raw = "sk-mocked-connection-secret-5555";
    let validated = "";
    const session = await createValidatedKeySession(raw, async (candidate) => { validated = candidate; return true; });
    expect(validated).toBe(raw);
    expect(JSON.stringify(session)).not.toContain(raw);
    expect(connectionStatus(session.id)).toMatchObject({ connected: true, source: "session", suffix: "5555" });
    vi.unstubAllEnvs();
  });

  it("clears a session on disconnect and never writes it to the data directory", () => {
    const raw = "sk-test-no-persistence-9876";
    const session = createKeySession(raw);
    expect(sessionCountForTests()).toBe(1);
    expect(clearKeySession(session.id)).toBe(true);
    expect(resolveApiKey(session.id)).toBeNull();
    const files = fs.existsSync(dataDirectory()) ? fs.readdirSync(dataDirectory(), { recursive: true }) : [];
    for (const file of files) {
      const full = path.join(dataDirectory(), String(file));
      if (fs.statSync(full).isFile()) expect(fs.readFileSync(full).toString()).not.toContain(raw);
    }
  });

  it("redacts key and authorization patterns", () => {
    const logged = redactSecrets('Authorization: Bearer sk-abcDEF123456789 and {"api_key":"sk-otherSecret987654"}');
    expect(logged).not.toContain("abcDEF");
    expect(logged).not.toContain("otherSecret");
    expect(logged).toContain("REDACTED");
  });

  it("does not use browser storage APIs for application credentials", () => {
    const sourceRoot = path.resolve(process.cwd(), "src");
    const files = fs.readdirSync(sourceRoot, { recursive: true }).filter((file) => /\.(ts|tsx)$/.test(String(file)));
    const applicationSource = files.map((file) => fs.readFileSync(path.join(sourceRoot, String(file)), "utf8")).join("\n");
    expect(applicationSource).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });
});

describe("upload and input security", () => {
  it("normalizes suspicious filenames", () => {
    expect(safeFileName("../../event brief<script>.md")).toBe("event-brief-script-.md");
  });
  it("accepts supported text/images and rejects unsupported MIME or size", () => {
    expect(validateTextUpload({ name: "brief.md", type: "text/markdown", size: 120 })).toBeNull();
    expect(validateTextUpload({ name: "brief.html", type: "text/html", size: 120 })).toMatch(/Only/);
    expect(validateAssetUpload({ name: "logo.png", type: "image/png", size: 120 })).toBeNull();
    expect(validateAssetUpload({ name: "logo.svg", type: "image/svg+xml", size: 120 })).toMatch(/Only/);
  });
  it("enforces selected context limits without silent truncation", () => {
    expect(() => assertContextSize([{ body: "x".repeat(MAX_CONTEXT_CHARS + 1) }])).toThrow(/limit/);
  });
  it("rejects unsafe and private source URLs", () => {
    expect(validatePublicSourceUrl("https://community.example/contact")).toBe(true);
    expect(validatePublicSourceUrl("javascript:alert(1)")).toBe(false);
    expect(validatePublicSourceUrl("http://127.0.0.1/private")).toBe(false);
    expect(validatePublicSourceUrl("http://192.168.1.10/private")).toBe(false);
  });
  it("uses path boundaries rather than vulnerable string-prefix checks", () => {
    expect(isPathInsideDataDirectory(path.join(dataDirectory(), "generated", "asset.png"))).toBe(true);
    expect(isPathInsideDataDirectory(`${dataDirectory()}-outside/asset.png`)).toBe(false);
  });
});

describe("email and CSV normalization", () => {
  it("normalizes only the domain and detects consumer domains", () => {
    expect(normalizeEmail("Jane.Doe@EXAMPLE.ORG")).toBe("Jane.Doe@example.org");
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
    expect(emailDomain("Person@GMAIL.COM")).toBe("gmail.com");
    expect(isConsumerEmail("Person@GMAIL.COM")).toBe(true);
  });
  it("escapes quotes, newlines, and spreadsheet formulas", () => {
    expect(escapeCsvCell('Hello, "team"\nnext')).toBe('"Hello, ""team""\nnext"');
    expect(escapeCsvCell("=HYPERLINK(\"bad\")")).toBe('"\'=HYPERLINK(""bad"")"');
  });
});
