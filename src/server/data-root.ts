import path from "node:path";

export function baseDataDirectory() {
  const configured = process.env.MARKETING_HUB_DATA_DIR || ".marketing-hub";
  return path.resolve(process.cwd(), configured);
}
