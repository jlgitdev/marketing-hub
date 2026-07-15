# Marketing Hub implementation plan

## Product and repository baseline

The starting workspace was empty: no package manager, framework, source, tests, database, Git metadata, or repository conventions. The selected baseline is therefore a focused, single-process TypeScript application: current stable Next.js App Router and React, Tailwind-backed custom styling, Node's built-in SQLite driver, Zod, the official OpenAI JavaScript SDK, Sharp, Vitest, React Testing Library, and Playwright.

Marketing Hub is single-user and local-only. Development and production commands bind to `127.0.0.1`. The project contains no deployment manifest, cloud service, remote authentication, analytics, queue, vector database, email sender, or social publisher.

## Architecture

```text
React browser UI
   ↓ same-origin localhost requests
Next.js Node route handlers
   ↓ validated domain services
   ├─ versioned SQLite repository
   ├─ local UUID asset storage
   └─ typed AI provider boundary
      ├─ OpenAI Responses/Image APIs
      └─ deterministic demo fixtures
```

Client modules never import SQLite, filesystem, Sharp, the OpenAI SDK, or API-key memory. Route handlers validate request boundaries. Domain services own prompts, model calls, deterministic validation, deduplication, exports, and image composition. Persistence and generated assets survive process restarts; ephemeral API keys do not.

## Routes and primary UI

- `/` — connection/context readiness, persisted metrics, state-derived action cards, and recent work.
- `/context` — paste/create/edit/preview/activate/classify/delete text documents and upload/manage raster brand assets.
- `/leads` — bounded research form, filters, sorting, evidence, duplicate review/merge, manual edits, outreach campaigns, recipient review, and CSV export.
- `/content` — campaign brief, selected context/platform guides, editable platform drafts, regeneration, image background/overlay composition, and downloads.
- `/runs` — research, outreach, and content records with status, context, model, prompt, usage when captured, warnings, reopen, and delete actions.
- `/settings` — temporary/environment connection state, privacy explanation, data directory, record counts, and two-step reset.

The shared navigation becomes a labeled bottom bar on narrow screens. Tables become readable evidence cards rather than horizontally overflowing.

## Persistence concepts

Versioned SQLite migrations create:

- `ContextDocument`
- `BrandAsset`
- `ResearchRun`
- `ResearchSource`
- `Lead`
- `LeadSource`
- `OutreachCampaign`
- `OutreachRecipient`
- `ContentCampaign`
- `PlatformPost`
- `GeneratedAsset`
- `ActivityEvent`

Indexes cover email, organization domain, research status/timestamp, confidence, platform, and campaign timestamp. Foreign keys cascade workflow-specific records. Binary assets are kept outside SQLite beneath `MARKETING_HUB_DATA_DIR`; database paths are never accepted from browser input.

## API-key handling

The dashboard and Settings submit a masked field to a localhost endpoint. A small explicit Responses request validates the key. The raw value is held only in a backend `Map` with expiration, while the browser receives a cryptographically random opaque HttpOnly, SameSite=Strict cookie. Secure is enabled automatically under HTTPS. Disconnect deletes the memory entry and cookie; process exit destroys every session.

`OPENAI_API_KEY` is an optional read-only environment fallback. Raw keys are excluded from SQLite, files, browser storage, cookies, HTML, URLs, logs, stack responses, content, and exports. Provider errors are classified and redacted.

## Context safety

Text input supports `.md`, `.txt`, paste, or blank creation. Raster assets support PNG, JPEG, and WebP. Limits cover per-file bytes, combined file count, accepted MIME types, title/body lengths, and selected AI-context size. Rendered Markdown uses a sanitizing rehype pipeline; raw uploaded code or HTML is never executed.

Every AI preflight shows the selected documents, approximate character count, and missing recommended types. Active source-of-truth documents take precedence when event context conflicts. Context upload itself never calls OpenAI.

## Lead research flow

1. Validate the editable region, objective, organization/event categories, target and audience roles, date range, keywords, result cap, and selected context.
2. Persist a running record with model, prompt version, settings, and context IDs.
3. Make a bounded discovery Responses request using `{ type: "web_search" }`, medium reasoning, explicit current date, and Bay Area approximate location when appropriate; search across customer segments and sales motions.
4. Enrich an oversized, diversity-balanced candidate pool in bounded cited batches and conditionally backfill shortages. Isolate malformed batches while preserving valid results. Request strict Zod-backed Structured Outputs containing organizations/events, nullable contacts, customer segment, sales motion, qualification signals, recommended sales action, fit, confidence, warnings, and supporting sources.
5. Preserve output URL annotations and complete search-source metadata.
6. Reject private/non-HTTP URLs, malformed dates/emails, unsupported enums, and any email lacking an exact accepted public source whose claim contains that address.
7. Flag consumer domains, third-party-only email evidence, domain mismatches, stale events, and conflicting information.
8. Compute a deterministic 100-point summit-sales score, enforce request constraints, and deduplicate by canonical identity within and across runs while retaining all evidence and warnings. Multi-tenant platform domains never collapse distinct hosted groups into one lead.
9. Persist raw sanitized provider output, source rows, lead/source joins, qualification details, review feedback, model, per-pass usage, and outcome.
10. Require human selection before lead-intelligence export and human review before any address is eligible for outreach export. Unverified emails are withheld from lead CSVs.

No crawler, guessed-email generator, SMTP probe, data broker, attendee list, paywall bypass, or private database is introduced. A relevant lead without an email remains as contact-page-only.

## Outreach flow

Selected leads create either a partner-share request with forwardable announcement or a direct invitation. Generation receives only selected context, stored lead facts, source-backed recipient facts, and user campaign instructions. Event claims may not be invented.

The saved campaign contains subject/body templates, preview text, CTA, announcement, prompt/model/provider metadata, warnings, and recipient-specific drafts. Users can edit the master or recipient, regenerate one/all, reset to master, exclude, copy, acknowledge missing-context warnings, and mark reviewed. Personalized evidence remains one click away. Outreach CSV exports only reviewed, non-excluded recipients with source-backed emails. A separate selected-lead CSV exports priority, segment, sales motion, next action, evidence, contact pages, and source URLs while withholding unverified emails. Both neutralize spreadsheet formulas while preserving commas, quotes, line breaks, and Unicode.

An interface defines the future approved email-delivery boundary, but this MVP provides no implementation, credentials, Send control, or scheduled follow-up.

## Content and image flow

The campaign form captures brief, objective, audience, CTA, phrases, image direction, selected platforms/context, optional active brand asset, and whether image generation is enabled. One coherent concept produces meaningfully distinct X, LinkedIn, and Instagram outputs with separate hook, CTA, hashtags, image text, alt text, style status, warnings, review state, and version.

Users edit, save, copy, review, regenerate one platform, or regenerate all text without changing saved images. A disabled image campaign makes no image request.

For images, the current Image API generates a base visual only after explicit action. The invariant prompt requests no text, letters, numbers, logos, watermark, signage, or pseudo-text. Sharp resizes to centralized platform presets and composites escaped exact headline, subheadline, CTA, and optional validated logo. Original backgrounds remain reusable; composite PNGs can be previewed, downloaded, or deleted. Text remains saved if image generation fails.

## Demo mode

`MARKETING_HUB_DEMO_MODE=true` selects deterministic fictional fixtures and makes no network request. Fixtures cover complete context, official role email, contact-page-only opportunity, duplicate, low confidence, warning, outreach, all three platform posts, image placeholder, provider failure, and image failure. Every source uses reserved `.example` domains, and the UI displays a persistent Demo mode banner.

## Testing and verification

- Unit tests: key masking/session/redaction/disconnect, file and URL safety, Markdown sanitization, context size, prompts, email/date/domain normalization, evidence enforcement, deduplication/merge, CSV safety, merge fields, platform constraints, and SVG escaping.
- Integration tests: migrations/persistence, context CRUD, demo research, source/contact-page preservation, outreach editing/export, platform generation/regeneration, image rendering/failure preservation, failed-run inspection, and restart reopening.
- Component tests: dynamic AI-context selection size and missing-context warning.
- Playwright: complete deterministic workflow, source inspection, lead selection, outreach review/CSV download, three-platform generation/edit, image generation/download, saved-run reopening, settings/privacy, desktop, and mobile.
- Gates: database initialization and migrations, lint, strict type checking, unit/integration tests, Playwright, production build, local production smoke, and visual/console inspection.

Live OpenAI calls are never made without an explicitly supplied key. When no key is available, provider-independent construction is automated and the separate manual guide records the exact billable verification procedure.

## Milestones

1. Scaffold, loopback scripts, migrations, configuration, and application shell.
2. Context library, visual assets, temporary key sessions, dashboard rules, and demo seed.
3. Responses web research, strict schema, citation preservation, deterministic lead validation/deduplication, and review UI.
4. Outreach campaign, recipient editing/review, spreadsheet-safe export, and future delivery boundary.
5. Platform copy, independent regeneration, Image API base asset, deterministic Sharp overlays, storage, and downloads.
6. Error/retry states, deletion/reset, accessibility/responsiveness, documentation, full automated validation, browser inspection, and manual live-provider guide.

## Risks and assumptions

- Search quality and public-email availability vary; human review, evidence visibility, contact-page-only retention, and confidence warnings mitigate this.
- Live calls can be slow, rate-limited, billable, or unavailable; limits, one active request, cancellation, bounded retry, progress, and sanitized errors mitigate this.
- Model aliases and image verification depend on the key owner; models are environment-configurable and stored with outputs.
- The local host process is trusted. Ephemeral storage prevents accidental key persistence but cannot defend against malware already controlling the device.
- Node's built-in SQLite API emits an experimental warning under Node 22 but passes the project’s persistence and production-build gates.
- The department remains responsible for outreach law, opt-out, and organizational contact policy. The application prepares drafts only.
