import { NextResponse } from "next/server";
import { z } from "zod";
import { outreachCsv } from "@/server/services/export-service";
import { errorResponse } from "@/server/security/request";

export async function GET(request: Request) {
  try {
    const campaignId = z.string().uuid().parse(new URL(request.url).searchParams.get("campaignId"));
    return new NextResponse(outreachCsv(campaignId), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="marketing-hub-outreach.csv"`, "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
