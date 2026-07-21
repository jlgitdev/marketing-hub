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
  | "spotlight_template"
  | "spotlight_batch"
  | "spotlight_retry"
  | "summit_agenda_batch";

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
  resultEntityType: "research" | "outreach" | "content" | "spotlight_template" | "spotlight" | "summit_agenda" | "asset" | null;
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

export type SpeakerSpotlightStatus = "queued" | "extracting" | "matching_headshot" | "checking_headshot" | "extraction_failed" | "ready_for_image" | "generating_image" | "finalizing" | "writing_post" | "completed" | "canceled" | "failed";

export type SpeakerSpotlightStage = "profile_extraction" | "headshot_match" | "headshot_face_check" | "caption_generation" | "image_edit" | "finalization";

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

export type SpeakerSpotlightTemplateStatus = "analyzing" | "ready" | "failed";

export type SpeakerSpotlightTemplateField =
  | "speaker_name"
  | "organization_name"
  | "role_line"
  | "topic_line"
  | "about"
  | "highlight_1"
  | "highlight_2"
  | "highlight_3"
  | "event_name"
  | "event_dates"
  | "event_venue"
  | "event_website";

export interface SpeakerSpotlightTemplateBlueprint {
  schemaVersion: 1;
  summary: string;
  layoutDescription: string;
  visualStyle: string;
  portraitTreatment: string;
  fixedElements: string[];
  variableElements: string[];
  fixedText: string[];
  exampleContentToRemove: string[];
  contentFields: SpeakerSpotlightTemplateField[];
  generationInstructions: string;
}

export interface SpeakerSpotlightTemplate {
  id: string;
  name: string;
  status: SpeakerSpotlightTemplateStatus;
  version: number;
  selected: boolean;
  sourceType: "builtin" | "user";
  originalFileName: string;
  mimeType: string;
  width: number;
  height: number;
  aspectRatio: string;
  sizeBytes: number;
  exampleSpeakerName: string | null;
  fixedGuidance: string;
  variableGuidance: string;
  captionGuidance: string;
  additionalGuidance: string;
  blueprint: SpeakerSpotlightTemplateBlueprint | null;
  model: string | null;
  requestId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface SpeakerSpotlightTemplateSnapshot {
  templateId: string;
  name: string;
  version: number;
  width: number;
  height: number;
  aspectRatio: string;
  captionGuidance: string;
  blueprint: SpeakerSpotlightTemplateBlueprint;
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
  templateId: string | null;
  templateSnapshot: SpeakerSpotlightTemplateSnapshot | null;
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

export interface SpeakerSpotlightBatchSummary {
  id: string;
  speakerNames: string[];
  status: SpeakerSpotlightBatch["status"];
  model: string;
  promptVersion: string;
  warnings: string[];
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  completedCount: number;
  resultCount: number;
}

export type SummitAgendaStageKey = "gpt" | "agi" | "pitch" | "workshop";

export interface SummitAgendaPerson {
  id: string;
  name: string;
  role: string;
  company: string;
  moderator: boolean;
  photo: string | null;
}

export interface SummitAgendaSession {
  id: string;
  sourceId: string;
  day: "day1" | "day2";
  stage: SummitAgendaStageKey;
  stageName: string;
  start: number;
  end: number;
  startLabel: string;
  endLabel: string;
  format: string;
  title: string;
  status: string;
  relation: string;
  notified: boolean;
  people: SummitAgendaPerson[];
}

export interface SummitAgendaDay {
  key: "day1" | "day2";
  label: string;
  date: string;
  sourceFile: string;
  sourceSha256: string;
  sessions: SummitAgendaSession[];
}

export interface SummitAgendaData {
  event: { name: string; location: string; timezone: string };
  stages: Array<{ key: SummitAgendaStageKey; name: string }>;
  references: { one: string; two: string; many: string };
  days: SummitAgendaDay[];
  updatedAt?: string;
}

export type SummitAgendaResultStatus = "queued" | "generating" | "completed" | "failed" | "canceled";

export interface SummitAgendaProviderError {
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

export interface SummitAgendaResult {
  id: string;
  batchId: string;
  sessionId: string;
  session: SummitAgendaSession;
  status: SummitAgendaResultStatus;
  imageAssetId: string | null;
  imageFileName: string | null;
  caption: string;
  prompt: string | null;
  requestId: string | null;
  providerError: SummitAgendaProviderError | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SummitAgendaBatch {
  id: string;
  sessionIds: string[];
  status: "running" | "completed" | "partially_completed" | "failed";
  model: string;
  promptVersion: string;
  provider: "openai" | "demo";
  warnings: string[];
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  results: SummitAgendaResult[];
}

export interface SummitAgendaBatchSummary {
  id: string;
  status: SummitAgendaBatch["status"];
  model: string;
  promptVersion: string;
  warnings: string[];
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  completedCount: number;
  resultCount: number;
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

export interface WorkspaceSummary {
  id: string;
  name: string;
  eventDate: string | null;
  location: string | null;
  goal: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  onboardingDismissedAt: string | null;
}

export interface WorkspaceState {
  activeWorkspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  demoMode: boolean;
  dataPath: string;
  connection: ConnectionStatus;
  contextDocuments: ContextDocument[];
  brandAssets: BrandAsset[];
  researchRuns: ResearchRun[];
  leads: LeadRecord[];
  outreachCampaigns: OutreachCampaign[];
  contentCampaigns: ContentCampaign[];
  speakerSpotlightTemplates: SpeakerSpotlightTemplate[];
  speakerSpotlightBatches: SpeakerSpotlightBatchSummary[];
  summitAgendaBatches: SummitAgendaBatchSummary[];
  counts: {
    activeContext: number;
    leads: number;
    awaitingReview: number;
    campaigns: number;
    speakerSpotlightTemplates: number;
    speakerSpotlights: number;
    summitAgendaPosts: number;
  };
}
