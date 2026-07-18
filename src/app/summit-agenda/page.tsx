import { SummitAgendaClient } from "@/components/summit-agenda-client";

export default async function SummitAgendaPage({ searchParams }: { searchParams: Promise<{ batch?: string | string[] }> }) {
  const parameters = await searchParams;
  const batchId = Array.isArray(parameters.batch) ? parameters.batch[0] || null : parameters.batch || null;
  return <SummitAgendaClient initialBatchId={batchId}/>;
}
