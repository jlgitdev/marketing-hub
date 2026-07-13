"use client";

import { useState } from "react";
import type { ContextDocument } from "@/lib/types";

export function ContextPicker({ documents, name = "contextDocumentIds" }: { documents: ContextDocument[]; name?: string }) {
  const [selected, setSelected] = useState(() => new Set(documents.map((document) => document.id)));
  const [automatic, setAutomatic] = useState(true);
  const selectedDocuments = documents.filter((document) => selected.has(document.id));
  const selectedEventBriefs = selectedDocuments.filter((document) => document.sourceOfTruth || document.type === "event_information" || /event/i.test(document.type));
  const selectedSourcesOfTruth = selectedEventBriefs.filter((document) => document.sourceOfTruth);
  const conflict = selectedEventBriefs.length > 1 && selectedSourcesOfTruth.length !== 1;
  const size = selectedDocuments.reduce((sum, document) => sum + document.body.length, 0);
  return <div className="context-selection">
    <input type="hidden" name="contextMode" value={automatic ? "auto" : "manual"}/>
    <label className="check auto-context-toggle"><input type="checkbox" checked={automatic} onChange={(event) => setAutomatic(event.target.checked)}/><span><strong>Automatic relevance selection</strong><small>Uses filenames, categories, tags, workflow purpose, and platform. Local source-of-truth documents take priority.</small></span></label>
    {!automatic && <div className="context-picker">{documents.map((document) => <label className="check context-chip" key={document.id}><input name={name} type="checkbox" value={document.id} checked={selected.has(document.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(document.id); else next.delete(document.id); return next; })}/>{document.title}<small>{document.type.replaceAll("_", " ")}</small></label>)}</div>}
    <div className="context-selection-summary"><span>{automatic ? `${documents.length} active documents available for automatic ranking` : `${selectedDocuments.length} selected · approximately ${size.toLocaleString()} characters`}</span><span>{!automatic && conflict && <strong>Multiple event-information documents need exactly one source of truth.</strong>}</span></div>
  </div>;
}
