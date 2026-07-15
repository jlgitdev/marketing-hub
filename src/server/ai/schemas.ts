import { z } from "zod";

export const LeadTargetSegmentSchema = z.enum([
  "ai_professionals", "technology_employees", "founders_operators", "researchers_academics",
  "college_students", "college_prep_education", "educators", "community_leaders",
  "investors_executives", "general_technology"
]);

export const LeadSalesMotionSchema = z.enum([
  "direct_ticket_sales", "group_ticket_sales", "partner_distribution", "employer_learning_budget",
  "education_distribution", "cross_promotion", "sponsorship"
]);

export const QualificationSignalsSchema = z.object({
  audienceFit: z.enum(["weak", "moderate", "strong", "exact"]),
  buyingSignal: z.enum(["none", "weak", "moderate", "strong"]),
  distributionPotential: z.enum(["none", "limited", "moderate", "high"]),
  localRelevance: z.enum(["none", "adjacent", "local"]),
  timingFit: z.enum(["poor", "neutral", "good", "urgent"]),
  decisionMakerAccess: z.enum(["unknown", "influencer", "decision_maker"]),
  audienceSizeLabel: z.string().nullable()
}).strict();

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
  targetSegment: LeadTargetSegmentSchema,
  salesMotion: LeadSalesMotionSchema,
  qualificationSignals: QualificationSignalsSchema,
  outreachAngle: z.string(),
  nextBestAction: z.string(),
  supportingSources: z.array(SupportingSourceSchema),
  confidence: z.enum(["high", "medium", "low"]),
  verificationStatus: z.enum(["source_backed", "contact_page_only", "requires_review"]),
  warnings: z.array(z.string())
}).strict();

export const DiscoveryCandidateSchema = z.object({
  organizationName: z.string(),
  organizationWebsite: z.string().nullable(),
  opportunityClass: z.enum(["organization", "event"]),
  eventName: z.string().nullable(),
  city: z.string(),
  region: z.string(),
  targetSegment: LeadTargetSegmentSchema,
  salesMotion: LeadSalesMotionSchema,
  audienceFit: z.enum(["weak", "moderate", "strong", "exact"]),
  distributionPotential: z.enum(["none", "limited", "moderate", "high"]),
  discoveryReason: z.string(),
  discoverySourceUrl: z.string()
}).strict();

export const DiscoveryBundleSchema = z.object({
  candidates: z.array(DiscoveryCandidateSchema),
  searchedSegments: z.array(LeadTargetSegmentSchema),
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
  faceVisible: z.boolean(),
  approved: z.boolean(),
  singlePerson: z.boolean(),
  usablePortrait: z.boolean(),
  notLogoGraphicOrThumbnail: z.boolean(),
  notVisiblyCorrupted: z.boolean(),
  issues: z.array(z.string())
}).strict();

export type ResearchBundle = z.infer<typeof ResearchBundleSchema>;
export type DiscoveryBundle = z.infer<typeof DiscoveryBundleSchema>;
export type OutreachBundle = z.infer<typeof OutreachBundleSchema>;
export type SocialBundle = z.infer<typeof SocialBundleSchema>;
export type SpeakerPost = z.infer<typeof SpeakerPostSchema>;
