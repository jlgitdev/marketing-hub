import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireSafeOrigin } from "@/server/security/request";
import { acknowledgeWorkspaceGuide, createWorkspace, deleteWorkspace, selectWorkspace } from "@/server/workspaces/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(80),
  eventDate: z.string().trim().max(40).optional().nullable(),
  location: z.string().trim().max(120).optional().nullable(),
  goal: z.string().trim().max(500).optional().nullable()
});

const WorkspaceActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("switch"), workspaceId: z.string().min(1).max(80) }),
  z.object({ action: z.literal("dismiss_guide"), workspaceId: z.string().min(1).max(80) })
]);

export async function POST(request: Request) {
  try {
    await requireSafeOrigin();
    const workspace = await createWorkspace(CreateWorkspaceSchema.parse(await request.json()));
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    await requireSafeOrigin();
    const input = WorkspaceActionSchema.parse(await request.json());
    const workspace = input.action === "switch"
      ? selectWorkspace(input.workspaceId)
      : acknowledgeWorkspaceGuide(input.workspaceId);
    return NextResponse.json({ workspace });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    await requireSafeOrigin();
    const input = z.object({ workspaceId: z.string().min(1).max(80), confirmationName: z.string().max(80) }).parse(await request.json());
    return NextResponse.json(deleteWorkspace(input.workspaceId, input.confirmationName));
  } catch (error) { return errorResponse(error); }
}
