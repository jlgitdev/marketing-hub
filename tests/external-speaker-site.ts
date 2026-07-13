import fs from "node:fs";
import path from "node:path";

export const externalSpeakerSiteDirectory = path.resolve(
  process.env.AGI_SUMMIT_SITE_DIR || path.join(process.cwd(), "agi-summit-site")
);

export const hasExternalSpeakerSite = fs.existsSync(externalSpeakerSiteDirectory)
  && fs.statSync(externalSpeakerSiteDirectory).isDirectory()
  && fs.readdirSync(externalSpeakerSiteDirectory, { recursive: true }).some((entry) => /(?:^|\/)index-.*\.js$/i.test(String(entry)));
