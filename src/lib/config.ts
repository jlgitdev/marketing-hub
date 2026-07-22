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
  content: "social-content-v3-prompt-first-full-artwork",
  assistantCreative: "assistant-creative-v2-full-artwork",
  image: "campaign-image-v3-gpt-image-2-one-shot",
  speakerSpotlight: "speaker-spotlight-v7-palace-template",
  summitAgenda: "summit-agenda-live-v3-3x4"
} as const;

export const SPEAKER_SPOTLIGHT_IMAGE_SPEC = {
  width: 1024,
  height: 1536,
  size: "1024x1536",
  aspectRatio: "2:3"
} as const;

export const SUMMIT_AGENDA_IMAGE_SPEC = {
  width: 1080,
  height: 1440,
  aspectRatio: "3:4",
  providerSize: "1024x1536"
} as const;

export const PLATFORM_CONFIG = {
  general: { label: "Any platform", characterLimit: 12_000, image: { width: 1024, height: 1024 } },
  x: { label: "X", characterLimit: 280, image: { width: 1200, height: 675 } },
  linkedin: { label: "LinkedIn", characterLimit: 3000, image: { width: 1200, height: 627 } },
  instagram: { label: "Instagram", characterLimit: 2200, image: { width: 1080, height: 1080 } }
} as const;
