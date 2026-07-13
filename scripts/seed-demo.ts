import { DEMO_CONTEXT } from "../src/server/ai/demo-provider";
import { createContextDocument, listContextDocuments } from "../src/server/db/repository";

const existingTitles = new Set(listContextDocuments().map((document) => document.title));
let created = 0;
for (const document of DEMO_CONTEXT) {
  if (!existingTitles.has(document.title)) { createContextDocument(document); created += 1; }
}
console.log(`Demo seed complete: ${created} fictional context documents added.`);
