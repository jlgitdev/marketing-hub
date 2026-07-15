import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteLead, listLeads, mergeStoredLeads, updateLead } from "@/server/db/repository";
import { emailSchema, normalizeEmail } from "@/server/security/validation";
import { errorResponse, requireSafeOrigin } from "@/server/security/request";

export const runtime = "nodejs";

const PatchSchema = z.object({
  id: z.string().uuid(),
  reviewStatus: z.enum(["unreviewed", "reviewed", "rejected", "needs_review"]).optional(),
  selected: z.boolean().optional(), contactName: z.string().max(160).nullable().optional(), contactRole: z.string().max(160).nullable().optional(),
  contactEmail: z.union([emailSchema, z.literal(""), z.null()]).optional(), recommendedAction: z.string().max(1000).optional(), fitExplanation: z.string().max(2000).optional(),
  rejectionReason: z.string().max(1000).nullable().optional()
});

export async function PATCH(request: Request) {
  try {
    await requireSafeOrigin();
    const { id, contactEmail, ...patch } = PatchSchema.parse(await request.json());
    const current = listLeads().find((lead) => lead.id === id);
    const normalized = contactEmail ? normalizeEmail(contactEmail) : null;
    const changedEmail = contactEmail !== undefined && normalized !== current?.contactEmail;
    const nextPatch = {
      ...patch,
      ...(contactEmail !== undefined ? { contactEmail: normalized } : {}),
      ...(changedEmail ? {
        emailCategory: "none" as const,
        emailSourceUrl: null,
        verificationStatus: normalized ? "requires_review" as const : current?.contactPageUrl ? "contact_page_only" as const : "requires_review" as const,
        reviewStatus: "needs_review" as const,
        warnings: Array.from(new Set([...(current?.warnings || []), normalized ? "User-edited email is not source-backed unless a reviewer separately confirms an exact public source URL." : "The source-backed email was removed by a user edit."]))
      } : {})
    };
    return NextResponse.json(updateLead(id, nextPatch));
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    await requireSafeOrigin();
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    deleteLead(id);
    return NextResponse.json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try { await requireSafeOrigin(); const input = z.object({ primaryId: z.string().uuid(), duplicateId: z.string().uuid() }).parse(await request.json()); return NextResponse.json(mergeStoredLeads(input.primaryId, input.duplicateId)); }
  catch (error) { return errorResponse(error); }
}
