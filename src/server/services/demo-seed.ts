import { isDemoMode } from "@/server/config";
import { DEMO_CONTEXT } from "@/server/ai/demo-provider";
import { createContextDocument, listContextDocuments } from "@/server/db/repository";

export function ensureDemoSeed() {
  if (!isDemoMode() || listContextDocuments().length > 0) return;
  for (const document of DEMO_CONTEXT) createContextDocument(document);
}
