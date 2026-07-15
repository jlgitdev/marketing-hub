import { NextResponse } from "next/server";
import { z } from "zod";
import { leadsCsv } from "@/server/services/export-service";
import { errorResponse, requireSafeOrigin } from "@/server/security/request";

export const runtime = "nodejs";

const QuerySchema = z.object({
  runId: z.union([z.string().uuid(), z.literal("")]).optional(),
  selected: z.enum(["true", "false"]).default("false"),
  minScore: z.coerce.number().int().min(0).max(100).default(0)
});

export async function GET(request: Request) {
  try {
    await requireSafeOrigin();
    const url = new URL(request.url);
    const query = QuerySchema.parse({ runId: url.searchParams.get("runId") || undefined, selected: url.searchParams.get("selected") || undefined, minScore: url.searchParams.get("minScore") || undefined });
    const csv = leadsCsv({ runId: query.runId || null, selectedOnly: query.selected === "true", minimumPriorityScore: query.minScore });
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="summit-sales-leads.csv"`, "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
