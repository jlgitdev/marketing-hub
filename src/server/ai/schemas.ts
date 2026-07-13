import { z } from "zod";

export const SupportingSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  sourceType: z.enum(["official", "event", "directory", "other"]),
  claim: z.string(),
  accessedAt: z.string()
}).strict();

export const LeadCandidateSchema = z.object({
  opportunityClass: z.enum(["organization", "event"]),
  organizationName: z.string(),
  organizationType: z.string(),
  organizationWebsite: z.string().nullable(),
  city: z.string(),
  region: z.string(),
  eventName: z.string().nullable(),
  eventUrl: z.string().nullable(),
  eventStartDate: z.string().nullable(),
  eventEndDate: z.string().nullable(),
  eventOrganizer: z.string().nullable(),
  contactName: z.string().nullable(),
  contactRole: z.string().nullable(),
  contactEmail: z.string().nullable(),
  emailCategory: z.enum(["published_professional", "role_based", "general_inbox", "none"]),
  emailSourceUrl: z.string().nullable(),
  contactPageUrl: z.string().nullable(),
  recommendedAction: z.string(),
  fitExplanation: z.string(),
  evidenceSummary: z.string(),
  supportingSources: z.array(SupportingSourceSchema),
  confidence: z.enum(["high", "medium", "low"]),
  verificationStatus: z.enum(["source_backed", "contact_page_only", "requires_review"]),
  warnings: z.array(z.string())
}).strict();

export const ResearchBundleSchema = z.object({
  leads: z.array(LeadCandidateSchema),
  warnings: z.array(z.string())
}).strict();

export const OutreachBundleSchema = z.object({
  campaignName: z.string(),
  subjectTemplate: z.string(),
  bodyTemplate: z.string(),
  callToAction: z.string(),
  previewText: z.string(),
  forwardableAnnouncement: z.string(),
  missingContextWarnings: z.array(z.string()),
  recipients: z.array(z.object({
    leadId: z.string(),
    subject: z.string(),
    body: z.string(),
    forwardableAnnouncement: z.string(),
    warnings: z.array(z.string())
  }).strict())
}).strict();

export const SocialBundleSchema = z.object({
  campaignConcept: z.string(),
  warnings: z.array(z.string()),
  posts: z.array(z.object({
    platform: z.enum(["x", "linkedin", "instagram"]),
    text: z.string(),
    hook: z.string(),
    callToAction: z.string(),
    hashtags: z.string(),
    imageHeadline: z.string().max(60),
    imageSubheadline: z.string().max(96),
    imageAltText: z.string().max(1000),
    imagePrompt: z.string().max(3000),
    warnings: z.array(z.string()),
    styleGuideStatus: z.enum(["selected_guide", "web_research", "fallback"])
  }).strict())
}).strict();

export const SpeakerPostSchema = z.object({
  post: z.string(),
  factualClaimsUsed: z.array(z.string()),
  warnings: z.array(z.string())
}).strict();

export const SpeakerHeadshotQaSchema = z.object({
  approved: z.boolean(),
  singlePerson: z.boolean(),
  usablePortrait: z.boolean(),
  notLogoGraphicOrThumbnail: z.boolean(),
  notVisiblyCorrupted: z.boolean(),
  issues: z.array(z.string())
}).strict();

export type ResearchBundle = z.infer<typeof ResearchBundleSchema>;
export type OutreachBundle = z.infer<typeof OutreachBundleSchema>;
export type SocialBundle = z.infer<typeof SocialBundleSchema>;
export type SpeakerPost = z.infer<typeof SpeakerPostSchema>;
