import path from "node:path";
import { z } from "zod";
import type { ContextDocument } from "@/lib/types";
import { MAX_ASSET_BYTES, MAX_CONTEXT_CHARS, MAX_TEXT_FILE_BYTES } from "@/lib/config";

const CONSUMER_DOMAINS = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com", "proton.me", "protonmail.com"]);
const MULTI_TENANT_PLATFORM_DOMAINS = new Set(["meetup.com", "eventbrite.com", "linkedin.com", "facebook.com", "instagram.com", "lu.ma", "luma.com"]);

export const safeUrlSchema = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}, "Only public HTTP(S) URLs are allowed");

export const emailSchema = z.string().email().max(254);

export function normalizeEmail(value: string) {
  const email = value.trim();
  const at = email.lastIndexOf("@");
  if (at < 1) return email.toLowerCase();
  return `${email.slice(0, at)}@${email.slice(at + 1).toLowerCase()}`;
}

export function emailDomain(email: string) {
  return normalizeEmail(email).split("@")[1] || "";
}

export function isConsumerEmail(email: string) {
  return CONSUMER_DOMAINS.has(emailDomain(email));
}

export function normalizeDomain(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isMultiTenantPlatformDomain(value: string | null | undefined) {
  if (!value) return false;
  const domain = value.toLowerCase().replace(/^www\./, "");
  return [...MULTI_TENANT_PLATFORM_DOMAINS].some((platform) => domain === platform || domain.endsWith(`.${platform}`));
}

export function normalizeEvidenceUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.+|gclid|fbclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeOrganizationName(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\b(the|inc|llc|ltd|foundation|association)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

export function safeFileName(value: string) {
  const base = path.basename(value).normalize("NFKC");
  return base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+/, "").slice(0, 120) || "file";
}

export function validateTextUpload(file: { name: string; type: string; size: number }) {
  const extension = path.extname(file.name).toLowerCase();
  if (![".md", ".txt"].includes(extension)) return "Only .md and .txt files are accepted.";
  if (file.size > MAX_TEXT_FILE_BYTES) return "Text files must be 1 MB or smaller.";
  if (file.type && !["text/markdown", "text/plain", "application/octet-stream"].includes(file.type)) return "Unsupported text MIME type.";
  return null;
}

export function validateAssetUpload(file: { name: string; type: string; size: number }) {
  const extension = path.extname(file.name).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) return "Only PNG, JPEG, and WebP assets are accepted.";
  if (file.size > MAX_ASSET_BYTES) return "Assets must be 8 MB or smaller.";
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return "Unsupported image MIME type.";
  return null;
}

export function selectedContextSize(documents: Array<{ body: string }>) {
  return documents.reduce((sum, document) => sum + document.body.length, 0);
}

export function assertContextSize(documents: Array<{ body: string }>) {
  const size = selectedContextSize(documents);
  if (size > MAX_CONTEXT_CHARS) throw new Error(`Selected context is ${size.toLocaleString()} characters; the limit is ${MAX_CONTEXT_CHARS.toLocaleString()}.`);
  return size;
}

export function contextConflictWarnings(documents: ContextDocument[]) {
  const eventBriefs = documents.filter((document) => document.sourceOfTruth || document.type === "event_information" || /event.*(brief|information|facts)/i.test(`${document.type} ${document.title}`));
  if (eventBriefs.length <= 1) return [];
  const sourcesOfTruth = eventBriefs.filter((document) => document.sourceOfTruth);
  if (sourcesOfTruth.length === 1) return [];
  return [sourcesOfTruth.length === 0
    ? "Multiple selected event briefs exist without a single source of truth; conflicting facts require review."
    : "Multiple selected event briefs are marked as source of truth; conflicting facts require review."];
}

export function validatePublicSourceUrl(value: string) {
  const parsed = safeUrlSchema.safeParse(value);
  if (!parsed.success) return false;
  const host = new URL(value).hostname.toLowerCase();
  return host !== "localhost" && host !== "127.0.0.1" && host !== "::1" && !/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

export function redactSecrets(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[REDACTED]")
    .replace(/("?(?:api[_-]?key|authorization)"?\s*[:=]\s*")([^"]+)(")/gi, "$1[REDACTED]$3");
}

export function escapeCsvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char] || char);
}
