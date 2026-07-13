import { SpeakerSpotlightClient } from "@/components/speaker-spotlight-client";

export default async function SpeakerSpotlightPage({ searchParams }: { searchParams: Promise<{ batch?: string | string[] }> }) {
  const parameters = await searchParams;
  const batchId = Array.isArray(parameters.batch) ? parameters.batch[0] || null : parameters.batch || null;
  return <SpeakerSpotlightClient initialBatchId={batchId}/>;
}
