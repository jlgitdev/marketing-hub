import fs from "node:fs";
import path from "node:path";
import type { BrandAsset } from "@/lib/types";
import { projectContextDirectory } from "@/server/config";
import { listBrandAssets } from "@/server/db/repository";
import { currentWorkspaceId, shouldImportProjectContext } from "@/server/workspaces/registry";
import { storeBrandAsset } from "@/server/storage/assets";

const creativeAssetGlobal = globalThis as typeof globalThis & { __marketingHubCreativeAssetImports?: Map<string, Promise<void>> };
const creativeAssetImports = creativeAssetGlobal.__marketingHubCreativeAssetImports ?? new Map<string, Promise<void>>();
creativeAssetGlobal.__marketingHubCreativeAssetImports = creativeAssetImports;

export async function ensureCreativeBrandAssets() {
  if (!shouldImportProjectContext()) return;
  const workspaceId = currentWorkspaceId();
  const activeImport = creativeAssetImports.get(workspaceId);
  if (activeImport) return activeImport;
  const task = importCreativeBrandAssets();
  creativeAssetImports.set(workspaceId, task);
  try { await task; } finally { creativeAssetImports.delete(workspaceId); }
}

export function selectCreativeBrandAssets() {
  const activeAssets = listBrandAssets().filter((asset) => asset.active);
  const logo = activeAssets.find((asset) => asset.type === "logo" && asset.title === "AGI Summit logo")
    || activeAssets.find((asset) => asset.type === "logo")
    || null;
  const styleReference = activeAssets.find((asset) => asset.type === "visual_reference" && asset.title === "AGI Summit social style reference")
    || activeAssets.find((asset) => asset.type === "event_art" || asset.type === "visual_reference")
    || null;
  return { activeAssets, logo, styleReference };
}

async function importCreativeBrandAssets() {
  const existing = listBrandAssets();
  const directory = projectContextDirectory();
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return;
  const files = fs.readdirSync(directory);
  const candidates: Array<{ type: BrandAsset["type"]; pattern: RegExp; title: string }> = [
    { type: "logo", pattern: /^agi summit logo.*\.(?:png|jpe?g|webp)$/i, title: "AGI Summit logo" },
    { type: "visual_reference", pattern: /^speaker spotlight social media image reference v3\.png$/i, title: "AGI Summit social style reference" }
  ];
  for (const candidate of candidates) {
    if (existing.some((asset) => asset.type === candidate.type && asset.title === candidate.title)) continue;
    const fileName = files.find((name) => candidate.pattern.test(name));
    if (!fileName) continue;
    const filePath = path.join(directory, fileName);
    const extension = path.extname(fileName).toLowerCase();
    const mimeType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
    try {
      const asset = await storeBrandAsset({ title: candidate.title, type: candidate.type, fileName, mimeType, bytes: fs.readFileSync(filePath) });
      existing.push(asset);
    } catch {
      // Canonical assets improve defaults but never block an otherwise valid request.
    }
  }
}
