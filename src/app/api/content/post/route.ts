import { NextResponse } from "next/server";
import { z } from "zod";
import { listContentCampaigns, updatePlatformPost } from "@/server/db/repository";
import { errorResponse, requireSafeOrigin } from "@/server/security/request";
import { PLATFORM_CONFIG } from "@/lib/config";

const Schema = z.object({ id: z.string().uuid(), text: z.string().max(10_000).optional(), hook: z.string().max(1000).optional(), callToAction: z.string().max(1000).optional(), hashtags: z.string().max(2000).optional(), imageHeadline: z.string().max(60).optional(), imageSubheadline: z.string().max(96).optional(), imageAltText: z.string().max(1000).optional(), reviewStatus: z.enum(["unreviewed", "reviewed", "rejected", "needs_review"]).optional() });

export async function PATCH(request: Request) {
  try {
    await requireSafeOrigin();
    const { id, ...patch } = Schema.parse(await request.json());
    if (patch.reviewStatus === "reviewed") {
      const post = listContentCampaigns().flatMap((campaign) => campaign.posts).find((item) => item.id === id);
      if (!post) throw new Error("Platform post not found.");
      const text = patch.text ?? post.text;
      if (text.length > PLATFORM_CONFIG[post.platform].characterLimit) throw new Error(`${PLATFORM_CONFIG[post.platform].label} copy must be within ${PLATFORM_CONFIG[post.platform].characterLimit} characters before review.`);
    }
    return NextResponse.json(updatePlatformPost(id, patch));
  }
  catch (error) { return errorResponse(error); }
}
