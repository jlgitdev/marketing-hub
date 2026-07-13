import path from "node:path";

export function dataDirectory() {
  const configured = process.env.MARKETING_HUB_DATA_DIR || ".marketing-hub";
  return path.resolve(process.cwd(), configured);
}

export function isPathInsideDataDirectory(candidate: string) {
  const relative = path.relative(dataDirectory(), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export const MODELS = {
  text: process.env.OPENAI_TEXT_MODEL || "gpt-5.6",
  image: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2"
};

export function projectContextDirectory() {
  return path.resolve(process.env.MARKETING_HUB_CONTEXT_DIR || path.join(process.cwd(), "assets for context"));
}

export function agiSummitSiteDirectory() {
  return path.resolve(process.env.AGI_SUMMIT_SITE_DIR || path.join(process.cwd(), "agi-summit-site"));
}

export function isDemoMode() {
  return process.env.MARKETING_HUB_DEMO_MODE === "true";
}
