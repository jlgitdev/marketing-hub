import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_ASSET_BYTES } from "@/lib/config";
import { currentSessionId, errorResponse, requireSafeOrigin } from "@/server/security/request";
import { listSpeakerSpotlightTemplates } from "@/server/db/repository";
import { startAiOperation } from "@/server/operations/manager";
import {
  createPendingSpeakerSpotlightTemplate,
  deleteSpeakerSpotlightTemplate,
  ensureDefaultSpeakerSpotlightTemplate,
  selectTemplate,
  SpeakerSpotlightTemplateCreateSchema,
  SpeakerSpotlightTemplateSelectionSchema
} from "@/server/services/speaker-spotlight-template-service";

export const runtime = "nodejs";
export const maxDuration = 900;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDefaultSpeakerSpotlightTemplate();
    return NextResponse.json({ templates: listSpeakerSpotlightTemplates() });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    await requireSafeOrigin();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a Speaker Spotlight template image.");
    if (file.size > MAX_ASSET_BYTES) throw new Error(`Speaker Spotlight templates must be ${Math.round(MAX_ASSET_BYTES / 1_000_000)} MB or smaller.`);
    const parsed = SpeakerSpotlightTemplateCreateSchema.parse({
      name: form.get("name"),
      exampleSpeakerName: form.get("exampleSpeakerName") || "",
      fixedGuidance: form.get("fixedGuidance"),
      variableGuidance: form.get("variableGuidance"),
      captionGuidance: form.get("captionGuidance") || "",
      additionalGuidance: form.get("additionalGuidance") || ""
    });
    const template = await createPendingSpeakerSpotlightTemplate({ ...parsed, fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
    const operation = startAiOperation({
      kind: "spotlight_template",
      label: `Analyze template · ${template.name}`,
      operationInput: { templateId: template.id },
      originPath: "/speaker-spotlight",
      targetKey: `spotlight:template:${template.id}`,
      sessionId: await currentSessionId(),
      totalUnits: 1,
      unitLabel: "template"
    });
    return NextResponse.json({ template, operation }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    await requireSafeOrigin();
    const { templateId } = SpeakerSpotlightTemplateSelectionSchema.parse(await request.json());
    const template = await selectTemplate(templateId);
    return NextResponse.json({ template, templates: listSpeakerSpotlightTemplates() });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    await requireSafeOrigin();
    const templateId = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    await deleteSpeakerSpotlightTemplate(templateId);
    return NextResponse.json({ deleted: true, templates: listSpeakerSpotlightTemplates() });
  } catch (error) { return errorResponse(error); }
}
