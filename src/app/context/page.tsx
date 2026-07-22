import { ContextClient } from "@/components/context-client";

export default async function ContextPage({ searchParams }: { searchParams: Promise<{ document?: string | string[] }> }) {
  const value = (await searchParams).document;
  const requestedDocumentId = Array.isArray(value) ? value[0] || null : value || null;
  return <ContextClient requestedDocumentId={requestedDocumentId}/>;
}
