export const APP_NAME = "Marketing Hub";
export const DEFAULT_REGION = "San Francisco Bay Area";
export const DEFAULT_RESULT_COUNT = 18;
export const MAX_RESULT_COUNT = 50;
export const MAX_CONTEXT_CHARS = 120_000;
export const MAX_TEXT_FILE_BYTES = 1_000_000;
export const MAX_ASSET_BYTES = 8_000_000;
export const MAX_FILES = 100;
export const KEY_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export const PROMPT_VERSIONS = {
  research: "summit-sales-research-v3-qualified-funnel",
  outreach: "outreach-v2-auto-context",
  content: "social-content-v2-auto-context",
  image: "campaign-image-v1",
  speakerSpotlight: "speaker-spotlight-v7-palace-template"
} as const;

export const SPEAKER_SPOTLIGHT_IMAGE_SPEC = {
  width: 1024,
  height: 1536,
  size: "1024x1536",
  aspectRatio: "2:3"
} as const;

export const PLATFORM_CONFIG = {
  x: { label: "X", characterLimit: 280, image: { width: 1200, height: 675 } },
  linkedin: { label: "LinkedIn", characterLimit: 3000, image: { width: 1200, height: 627 } },
  instagram: { label: "Instagram", characterLimit: 2200, image: { width: 1080, height: 1080 } }
} as const;
