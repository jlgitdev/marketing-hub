import { ContentClient } from "@/components/content-client";

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ campaign?: string | string[] }> }) {
  const parameters = await searchParams;
  const campaignId = Array.isArray(parameters.campaign) ? parameters.campaign[0] || null : parameters.campaign || null;
  return <ContentClient initialCampaignId={campaignId}/>;
}
