export const SUGGESTED_CONTEXT_CATEGORIES = [
  "event_information",
  "brand_voice",
  "target_audience",
  "outreach_guidance",
  "platform_guidance",
  "approved_example",
  "workflow_guide",
  "campaign_notes",
  "reference"
] as const;

export type ContextType = string;
export type RunStatus = "draft" | "queued" | "running" | "completed" | "partially_completed" | "failed" | "canceled";
export type Confidence = "high" | "medium" | "low";
export type ReviewStatus = "unreviewed" | "reviewed" | "rejected" | "needs_review";
export type Platform = "x" | "linkedin" | "instagram";

export type LeadTargetSegment =
  | "ai_professionals"
  | "technology_employees"
  | "founders_operators"
  | "researchers_academics"
  | "college_students"
  | "college_prep_education"
  | "educators"
  | "community_leaders"
  | "investors_executives"
  | "general_technology";

export type LeadSalesMotion =
  | "direct_ticket_sales"
  | "group_ticket_sales"
  | "partner_distribution"
  | "employer_learning_budget"
  | "education_distribution"
  | "cross_promotion"
  | "sponsorship";

export type LeadPriorityTier = "hot" | "strong" | "promising" | "nurture";

export interface LeadQualification {
  audienceFit: "weak" | "moderate" | "strong" | "exact";
  buyingSignal: "none" | "weak" | "moderate" | "strong";
  distributionPotential: "none" | "limited" | "moderate" | "high";
  localRelevance: "none" | "adjacent" | "local";
  timingFit: "poor" | "neutral" | "good" | "urgent";
  decisionMakerAccess: "unknown" | "influencer" | "decision_maker";
  audienceSizeLabel: string | null;
  scoreBreakdown: {
    audienceFit: number;
    revenuePotential: number;
    distribution: number;
    contactability: number;
    localRelevance: number;
    timing: number;
    evidenceQuality: number;
  };
}

export type AiOperationKind =
  | "research"
  | "outreach_create"
  | "outreach_regenerate"
  | "content_create"
  | "content_regenerate"
  | "content_image"
  | "spotlight_batch"
  | "spotlight_retry";

export type AiOperationStatus =
  | "queued"
  | "running"
  | "cancel_requested"
  | "completed"
  | "partially_completed"
  | "failed"
  | "canceled"
  | "interrupted";

export type AiOperationStepState = "pending" | "active" | "completed" | "failed" | "skipped";

export interface AiOperationStep {
  id: string;
  label: string;
  state: AiOperationStepState;
  detail: string | null;
}

export interface AiOperation {
  id: string;
  kind: AiOperationKind;
  label: string;
  status: AiOperationStatus;
  steps: AiOperationStep[];
  completedUnits: number | null;
  totalUnits: number | null;
  unitLabel: string | null;
  resultEntityType: "research" | "outreach" | "content" | "spotlight" | "asset" | null;
  resultEntityId: string | null;
  resultHref: string | null;
  originPath: string;
  targetKey: string;
  error: string | null;
  retryable: boolean;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
}

export interface ContextDocument {
  id: string;
  title: string;
  type: ContextType;
  body: string;
  active: boolean;
  sourceOfTruth: boolean;
  notes: string;
  summary: string;
  tags: string[];
  platforms: string[];
  purposes: string[];
  origin: "user" | "project_asset" | "demo";
  sourcePath: string | null;
  contentHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrandAsset {
  id: string;
  title: string;
  type: "logo" | "event_art" | "visual_reference" | "partner_mark";
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  active: boolean;
  createdAt: string;
}

export interface SupportingSource {
  id?: string;
  title: string;
  url: string;
  sourceType: "official" | "event" | "directory" | "other";
  claim: string;
  citationMetadata?: Record<string, unknown>;
  accessedAt: string;
}

export interface LeadRecord {
  id: string;
  researchRunId: string;
  opportunityClass: "organization" | "event";
  organizationName: string;
  organizationType: string;
  organizationWebsite: string | null;
  organizationDomain: string | null;
  city: string;
  region: string;
  eventName: string | null;
  eventUrl: string | null;
  eventStartDate: string | null;
  eventEndDate: string | null;
  eventOrganizer: string | null;
  contactName: string | null;
  contactRole: string | null;
  contactEmail: string | null;
  emailCategory: "published_professional" | "role_based" | "general_inbox" | "none";
  emailSourceUrl: string | null;
  contactPageUrl: string | null;
  recommendedAction: string;
  fitExplanation: string;
  evidenceSummary: string;
  targetSegment: LeadTargetSegment;
  salesMotion: LeadSalesMotion;
  priorityScore: number;
  priorityTier: LeadPriorityTier;
  qualification: LeadQualification;
  outreachAngle: string;
  nextBestAction: string;
  canonicalKey: string;
  lastVerifiedAt: string;
  rejectionReason: string | null;
  confidence: Confidence;
  verificationStatus: "source_backed" | "contact_page_only" | "requires_review";
  warnings: string[];
  researchedAt: string;
  reviewStatus: ReviewStatus;
  selected: boolean;
  userEdits: Record<string, unknown>;
  sources: SupportingSource[];
}

export interface ResearchRun {
  id: string;
  name: string;
  objective: string;
  region: string;
  status: RunStatus;
  requestedCount: number;
  resultCount: number;
  contextDocumentIds: string[];
  settings: Record<string, unknown>;
  model: string;
  promptVersion: string;
  provider: "openai" | "demo";
  usage: Record<string, unknown> | null;
  warnings: string[];
  error: string | null;
  rawOutput: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface OutreachRecipient {
  id: string;
  campaignId: string;
  leadId: string;
  email: string | null;
  subject: string;
  body: string;
  forwardableAnnouncement: string;
  reviewStatus: ReviewStatus;
  excluded: boolean;
  warnings: string[];
}

export interface OutreachCampaign {
  id: string;
  name: string;
  mode: "partner_share" | "direct_invitation" | "sales_motion";
  status: "draft" | "reviewed";
  contextDocumentIds: string[];
  subjectTemplate: string;
  bodyTemplate: string;
  callToAction: string;
  previewText: string;
  forwardableAnnouncement: string;
  model: string;
  promptVersion: string;
  provider: "openai" | "demo";
  usage: Record<string, unknown> | null;
  warnings: string[];
  createdAt: string;
  updatedAt: string;
  recipients: OutreachRecipient[];
}

export interface PlatformPost {
  id: string;
  campaignId: string;
  platform: Platform;
  text: string;
  hook: string;
  callToAction: string;
  hashtags: string;
  imageHeadline: string;
  imageSubheadline: string;
  imageAltText: string;
  imagePrompt: string;
  warnings: string[];
  styleGuideStatus: "selected_guide" | "web_research" | "fallback";
  reviewStatus: ReviewStatus;
  version: number;
}

export type SpeakerSpotlightStatus = "queued" | "extracting" | "matching_headshot" | "checking_headshot" | "extraction_failed" | "ready_for_image" | "generating_image" | "checking_image" | "retrying_image" | "finalizing" | "image_review_required" | "writing_post" | "completed" | "canceled" | "failed";

export type SpeakerSpotlightStage = "profile_extraction" | "headshot_match" | "headshot_qa" | "caption_generation" | "image_edit" | "image_validation" | "image_qa" | "finalization";

export interface SpeakerSpotlightProviderError {
  stage: SpeakerSpotlightStage;
  code: string;
  status: number | null;
  providerCode: string | null;
  providerType: string | null;
  param: string | null;
  requestId: string | null;
  retryable: boolean;
  moderationStage: string | null;
  moderationCategories: string[];
}

export interface SpeakerProfile {
  inputName: string;
  displayName: string;
  profileKey: string;
  subtitle: string | null;
  roleLine: string | null;
  bio: string | null;
  highlights: Array<{ label: string; text: string }>;
  industries: string[];
  stats: string[];
  tags: string[];
  badge: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
  xHandle: string | null;
  source: { bundlePath: string; verified: boolean };
}

export interface SpeakerSpotlightImageQaChecks {
  modelReportedApproved: boolean;
  identityMatchesHeadshot: boolean;
  exampleSpeakerAbsent: boolean;
  nameSpelledExactly: boolean;
  factsMatchFrozenCopy: boolean;
  eventDetailsCorrect: boolean;
  exactlyThreeTopicChips: boolean;
  textLegibleAndUnclipped: boolean;
  styleCloselyMatchesReference: boolean;
  modelReportedNoUnsupportedContent: boolean;
  reportedUnsupportedVisibleText: string[];
  unsupportedVisibleText: string[];
  noUnsupportedContent: boolean;
}

export interface SpeakerSpotlightImageAttemptResult {
  attempt: number;
  imageRequestId: string | null;
  qaRequestId: string | null;
  mechanicalChecksPassed: boolean;
  checks: SpeakerSpotlightImageQaChecks | null;
  approved: boolean;
  issues: string[];
}

export interface SpeakerSpotlightQa {
  profileVerified: boolean;
  headshotVerified: boolean;
  headshotVerificationMethod: string | null;
  imageModel: string;
  imageSize: string | null;
  imageAspectRatio: string | null;
  imageValidationMode: "mechanical_only" | "vision_qa";
  imageAttempts: number;
  imageTextVerified: boolean | null;
  identityVerified: boolean | null;
  postFactsVerified: boolean;
  issues: string[];
  imageAttemptResults: SpeakerSpotlightImageAttemptResult[];
  humanReviewApprovedAt: string | null;
}

export interface SpeakerSpotlightResult {
  id: string;
  batchId: string;
  inputName: string;
  profileKey: string;
  slug: string;
  status: SpeakerSpotlightStatus;
  profile: SpeakerProfile | null;
  post: string | null;
  headshotFileName: string | null;
  imageFileName: string | null;
  headshotAssetId: string | null;
  imageAssetId: string | null;
  imagePrompt: string | null;
  qa: SpeakerSpotlightQa | null;
  requestIds: string[];
  retryCount: number;
  providerError: SpeakerSpotlightProviderError | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpeakerSpotlightBatch {
  id: string;
  speakerNames: string[];
  status: "running" | "completed" | "partially_completed" | "failed";
  config: {
    eventName: string;
    eventDates: string;
    eventVenue: string;
    eventWebsite: string;
    ticketUrl: string;
    discountCopy: string;
    siteDirectory: string;
  };
  model: string;
  promptVersion: string;
  provider: "openai" | "demo";
  warnings: string[];
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  results: SpeakerSpotlightResult[];
}

export interface GeneratedAsset {
  id: string;
  campaignId: string;
  kind: "background" | "composite";
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  prompt: string;
  overlay: Record<string, unknown>;
  model: string;
  createdAt: string;
}

export interface ContentCampaign {
  id: string;
  name: string;
  brief: string;
  objective: string;
  targetAudience: string;
  callToAction: string;
  requiredPhrases: string;
  prohibitedPhrases: string;
  headline: string;
  imageDirection: string;
  imageGenerationEnabled: boolean;
  selectedBrandAssetId: string | null;
  contextDocumentIds: string[];
  platforms: Platform[];
  status: "draft" | "completed" | "failed";
  model: string;
  promptVersion: string;
  provider: "openai" | "demo";
  usage: Record<string, unknown> | null;
  warnings: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
  posts: PlatformPost[];
  assets: GeneratedAsset[];
}

export interface ConnectionStatus {
  connected: boolean;
  source: "session" | "environment" | "demo" | "none";
  suffix: string | null;
  state: "connected" | "disconnected" | "invalid_key" | "rate_limited" | "model_access" | "network" | "provider_unavailable";
  message: string;
}

export interface WorkspaceState {
  demoMode: boolean;
  dataPath: string;
  connection: ConnectionStatus;
  contextDocuments: ContextDocument[];
  brandAssets: BrandAsset[];
  researchRuns: ResearchRun[];
  leads: LeadRecord[];
  outreachCampaigns: OutreachCampaign[];
  contentCampaigns: ContentCampaign[];
  speakerSpotlightBatches: SpeakerSpotlightBatch[];
  counts: {
    activeContext: number;
    leads: number;
    awaitingReview: number;
    campaigns: number;
    speakerSpotlights: number;
  };
}
