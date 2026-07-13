import { LeadsClient } from "@/components/leads-client";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ run?: string | string[]; outreach?: string | string[] }> }) {
  const parameters = await searchParams;
  return <LeadsClient initialRunId={first(parameters.run)} initialOutreachId={first(parameters.outreach)}/>;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || null : value || null;
}
