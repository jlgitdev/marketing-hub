import { NextResponse } from "next/server";
import { z } from "zod";
import { listLeads, listOutreachCampaigns, updateOutreachRecipient } from "@/server/db/repository";
import { errorResponse, requireSafeOrigin } from "@/server/security/request";
import { unresolvedPlaceholders } from "@/server/services/export-service";

const Schema = z.object({ id: z.string().uuid(), subject: z.string().max(500).optional(), body: z.string().max(20_000).optional(), forwardableAnnouncement: z.string().max(10_000).optional(), reviewStatus: z.enum(["unreviewed", "reviewed", "rejected", "needs_review"]).optional(), excluded: z.boolean().optional() });

export async function PATCH(request: Request) {
  try {
    await requireSafeOrigin();
    const { id, ...patch } = Schema.parse(await request.json());
    if (patch.reviewStatus === "reviewed") {
      const campaign = listOutreachCampaigns().find((item) => item.recipients.some((recipient) => recipient.id === id));
      const recipient = campaign?.recipients.find((item) => item.id === id);
      const lead = recipient ? listLeads().find((item) => item.id === recipient.leadId) : null;
      if (!campaign || !recipient || !lead) throw new Error("Outreach recipient not found.");
      if (patch.excluded ?? recipient.excluded) throw new Error("Excluded recipients cannot be marked reviewed.");
      if (!recipient.email || !lead.contactEmail || recipient.email.toLowerCase() !== lead.contactEmail.toLowerCase() || lead.verificationStatus !== "source_backed" || !lead.emailSourceUrl) throw new Error("A recipient needs an exact source-backed professional email before review.");
      const subject = patch.subject ?? recipient.subject;
      const body = patch.body ?? recipient.body;
      if ((campaign.warnings.length > 0 || unresolvedPlaceholders(`${subject}\n${body}`).length > 0) && campaign.status !== "reviewed") throw new Error("Resolve or explicitly acknowledge missing-context warnings before review.");
    }
    return NextResponse.json(updateOutreachRecipient(id, patch));
  }
  catch (error) { return errorResponse(error); }
}
