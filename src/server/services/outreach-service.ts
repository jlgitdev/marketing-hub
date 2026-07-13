import crypto from "node:crypto";
import { z } from "zod";
import { PROMPT_VERSIONS } from "@/lib/config";
import { isDemoMode, MODELS } from "@/server/config";
import type { OutreachCampaign } from "@/lib/types";
import { demoOutreachBundle } from "@/server/ai/demo-provider";
import { outreachWithOpenAI } from "@/server/ai/openai-provider";
import { createOutreachCampaign, listContextDocuments, listLeads, listOutreachCampaigns, updateOutreachRecipient } from "@/server/db/repository";
import { assertContextSize, contextConflictWarnings } from "@/server/security/validation";
import { selectRelevantContext } from "./context-service";
import type { OperationReporter } from "@/server/operations/types";

export const OutreachInputSchema = z.object({
  name: z.string().min(2).max(120),
  mode: z.enum(["partner_share", "direct_invitation"]),
  leadIds: z.array(z.string().uuid()).min(1).max(50),
  contextDocumentIds: z.array(z.string().uuid()).default([]),
  contextMode: z.enum(["auto", "manual"]).default("auto"),
  instructions: z.string().max(1000).default("")
});

export async function generateOutreach(input: z.input<typeof OutreachInputSchema>, apiKey: string | null, signal?: AbortSignal, reporter?: OperationReporter) {
  reporter?.stage("loading", "Loading selected leads and the approved event and voice context.");
  reporter?.checkpoint();
  const parsed = OutreachInputSchema.parse(input);
  const leads = listLeads().filter((lead) => parsed.leadIds.includes(lead.id));
  const selection = selectRelevantContext({ workflow: "outreach", query: `${parsed.name} ${parsed.mode} ${parsed.instructions} ${leads.map((lead) => `${lead.organizationName} ${lead.fitExplanation}`).join(" ")}`, manualIds: parsed.contextDocumentIds, automatic: parsed.contextMode === "auto" });
  const context = selection.documents;
  if (leads.length !== parsed.leadIds.length) throw new Error("One or more selected leads no longer exist.");
  assertContextSize(context);
  reporter?.stage("drafting", `OpenAI is drafting a master message and ${leads.length} personalized recipient version${leads.length === 1 ? "" : "s"}.`);
  reporter?.checkpoint();
  const providerResult = isDemoMode() ? { bundle: demoOutreachBundle(parsed.mode, leads), usage: null } : await outreachWithOpenAI(requireKey(apiKey), { mode: parsed.mode, leads, context, instructions: parsed.instructions }, signal);
  reporter?.stage("checking", "Checking merge fields, evidence boundaries, and export-safe recipient details.");
  reporter?.checkpoint();
  const bundle = providerResult.bundle;
  const campaignWarnings = [...bundle.missingContextWarnings, ...contextConflictWarnings(context)];
  if (!context.some((document) => document.sourceOfTruth || document.type === "event_information" || /event/i.test(document.type))) campaignWarnings.push("No event-information source was selected; unresolved event merge fields must be resolved or explicitly acknowledged.");
  const now = new Date().toISOString();
  const campaignId = crypto.randomUUID();
  const campaign: OutreachCampaign = {
    id: campaignId, name: parsed.name || bundle.campaignName, mode: parsed.mode, status: "draft", contextDocumentIds: selection.documentIds,
    subjectTemplate: bundle.subjectTemplate, bodyTemplate: bundle.bodyTemplate, callToAction: bundle.callToAction, previewText: bundle.previewText, forwardableAnnouncement: bundle.forwardableAnnouncement, model: isDemoMode() ? "demo-provider-v1" : MODELS.text, promptVersion: PROMPT_VERSIONS.outreach, provider: isDemoMode() ? "demo" : "openai", usage: providerResult.usage,
    warnings: Array.from(new Set(campaignWarnings)), createdAt: now, updatedAt: now,
    recipients: leads.map((lead) => {
      const generated = bundle.recipients.find((recipient) => recipient.leadId === lead.id);
      const subject = generated?.subject || bundle.subjectTemplate.replaceAll("{{organization_name}}", lead.organizationName);
      const body = generated?.body || bundle.bodyTemplate.replaceAll("{{organization_name}}", lead.organizationName);
      const unresolved = Array.from(`${subject}\n${body}`.matchAll(/{{([a-z_]+)}}|\[NEEDS ([^\]]+)\]/g)).map((match) => match[1] || match[2]);
      const exportableEmail = lead.verificationStatus === "source_backed" && lead.emailSourceUrl && lead.contactEmail ? lead.contactEmail : null;
      return {
        id: crypto.randomUUID(), campaignId, leadId: lead.id, email: exportableEmail,
        subject,
        body,
        forwardableAnnouncement: generated?.forwardableAnnouncement || bundle.forwardableAnnouncement,
        reviewStatus: "unreviewed", excluded: false,
        warnings: [...(generated?.warnings || []), ...(exportableEmail ? [] : ["No source-backed recipient email; export will omit this recipient."]), ...(unresolved.length ? [`Unresolved placeholders: ${Array.from(new Set(unresolved)).join(", ")}.`] : [])]
      };
    })
  };
  reporter?.stage("saving", "Saving the campaign and recipient drafts locally for human review.");
  reporter?.checkpoint();
  return createOutreachCampaign(campaign);
}

function requireKey(key: string | null) {
  if (!key) throw new Error("Connect an OpenAI API key before generating live outreach.");
  return key;
}

export async function regenerateOutreach(campaignId: string, recipientId: string | null, apiKey: string | null, signal?: AbortSignal, reporter?: OperationReporter) {
  reporter?.stage("loading", "Loading the saved campaign, active context, and selected recipient facts.");
  reporter?.checkpoint();
  const campaign = listOutreachCampaigns().find((item) => item.id === campaignId);
  if (!campaign) throw new Error("Outreach campaign not found.");
  const recipients = recipientId ? campaign.recipients.filter((item) => item.id === recipientId) : campaign.recipients;
  if (!recipients.length) throw new Error("Outreach recipient not found.");
  const leadMap = new Map(listLeads().map((lead) => [lead.id, lead]));
  const leads = recipients.map((recipient) => leadMap.get(recipient.leadId)).filter((lead): lead is NonNullable<typeof lead> => Boolean(lead));
  const context = listContextDocuments().filter((document) => campaign.contextDocumentIds.includes(document.id) && document.active);
  if (!context.length) throw new Error("The campaign has no active context documents. Re-enable context before regenerating outreach.");
  assertContextSize(context);
  reporter?.stage("drafting", `OpenAI is regenerating ${recipients.length} recipient draft${recipients.length === 1 ? "" : "s"}.`);
  reporter?.checkpoint();
  const providerResult = isDemoMode() ? { bundle: demoOutreachBundle(campaign.mode, leads), usage: null } : await outreachWithOpenAI(requireKey(apiKey), { mode: campaign.mode, leads, context, instructions: "Regenerate the selected saved recipient drafts while preserving the approved factual boundaries." }, signal);
  const bundle = providerResult.bundle;
  reporter?.stage("checking", "Checking regenerated messages for unresolved fields and saved factual boundaries.");
  reporter?.checkpoint();
  reporter?.stage("saving", "Saving regenerated drafts and returning them to unreviewed status.");
  reporter?.checkpoint();
  for (const recipient of recipients) {
    const generated = bundle.recipients.find((item) => item.leadId === recipient.leadId);
    if (!generated) continue;
    updateOutreachRecipient(recipient.id, { subject: generated.subject, body: generated.body, forwardableAnnouncement: generated.forwardableAnnouncement, warnings: generated.warnings, reviewStatus: "unreviewed" });
  }
  return listOutreachCampaigns().find((item) => item.id === campaignId)!;
}
