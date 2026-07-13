import { NextResponse } from "next/server";
import { z } from "zod";
import { createContextDocument, deleteContextDocument, listContextDocuments, updateContextDocument } from "@/server/db/repository";
import { errorResponse, requireSafeOrigin } from "@/server/security/request";
import { MAX_CONTEXT_CHARS } from "@/lib/config";
import { deriveContextMetadata, normalizeContextCategory } from "@/server/services/context-service";

export const runtime = "nodejs";

const CreateSchema = z.object({
  title: z.string().min(1).max(160), type: z.string().max(80).default("auto"), body: z.string().max(MAX_CONTEXT_CHARS),
  active: z.boolean().default(true), sourceOfTruth: z.boolean().default(false), notes: z.string().max(500).default(""),
  tags: z.array(z.string().max(60)).max(40).optional(), platforms: z.array(z.string().max(40)).max(12).optional(), purposes: z.array(z.string().max(40)).max(12).optional()
});
const PatchSchema = CreateSchema.partial().extend({ id: z.string().uuid() });

export async function GET() {
  return NextResponse.json(listContextDocuments());
}

export async function POST(request: Request) {
  try {
    await requireSafeOrigin();
    const input = CreateSchema.parse(await request.json());
    const derived = deriveContextMetadata(input.title, input.body);
    return NextResponse.json(createContextDocument({
      ...input, type: input.type === "auto" ? derived.type : normalizeContextCategory(input.type),
      sourceOfTruth: input.sourceOfTruth || derived.sourceOfTruth, summary: derived.summary,
      tags: input.tags || derived.tags, platforms: input.platforms || derived.platforms, purposes: input.purposes || derived.purposes,
      origin: "user", sourcePath: null, contentHash: null
    }), { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    await requireSafeOrigin();
    const { id, ...patch } = PatchSchema.parse(await request.json());
    const current = listContextDocuments().find((document) => document.id === id);
    if (!current) throw new Error("Context document not found.");
    const title = patch.title ?? current.title;
    const body = patch.body ?? current.body;
    const derived = deriveContextMetadata(title, body, current.sourcePath);
    return NextResponse.json(updateContextDocument(id, {
      ...patch,
      ...(patch.type ? { type: patch.type === "auto" ? derived.type : normalizeContextCategory(patch.type) } : {}),
      ...(patch.title !== undefined || patch.body !== undefined ? { summary: derived.summary, tags: patch.tags || derived.tags, platforms: patch.platforms || derived.platforms, purposes: patch.purposes || derived.purposes } : {})
    }));
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    await requireSafeOrigin();
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    deleteContextDocument(id);
    return NextResponse.json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}
