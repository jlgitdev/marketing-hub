# Marketing Hub

Marketing Hub is a single-user, local-only browser application for AI-event marketing teams. It keeps flexible event context, source-backed opportunity research, review-ready outreach, social copy, campaign graphics, and verified Speaker Spotlight packages in one workspace.

The application does **not** send email, publish social posts, expose a public server, or use cloud persistence. Live AI operations require internet access and use the API credits of the supplied OpenAI key.

## Primary routes

- `/` — state-derived next actions and recent work
- `/context` — Markdown/text context and brand assets
- `/leads` — bounded opportunity research, source review, outreach, CSV export
- `/content` — X, LinkedIn, and Instagram copy plus campaign graphics
- `/speaker-spotlight` — multi-speaker profile/headshot verification, Palace of Fine Arts 2:3 editorial posters, and cross-platform captions
- `/runs` — saved research and content work
- `/settings` — temporary OpenAI connection, local data path, reset

Long AI actions acknowledge immediately and continue in a serialized local background queue. Inline stage cards and the global activity dock show real stages, elapsed time, queue state, cancellation, retry, and result links across navigation or reload. Percentages are never simulated; numeric progress appears only for countable platform or speaker work.

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- A modern browser
- Optional OpenAI API key for live mode

## Clean installation

```bash
npm install
cp .env.example .env.local
npm run db:init
```

No Docker, external database, account, or cloud service is required. SQLite initializes automatically as well, so `db:init` is safe to repeat.

## Local development

```bash
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The command binds to `127.0.0.1`, never `0.0.0.0`.

## Deterministic demo mode

Demo mode makes no external requests and requires no API key:

```bash
MARKETING_HUB_DEMO_MODE=true npm run dev
```

The UI displays a persistent Demo mode banner. Research/outreach organizations, contacts, and `.example` sources are fictional. Speaker Spotlight may still read the configured downloaded AGI Summit site locally, but it creates deterministic graphics and makes no network or OpenAI request. Seed only the example context into a non-demo local workspace with:

```bash
npm run db:seed:demo
```

For deterministic progress-state testing, add a delay before each demo operation begins:

```bash
MARKETING_HUB_DEMO_MODE=true MARKETING_HUB_DEMO_DELAY_MS=1500 npm run dev
```

## Live lead quality benchmark

After configuring `OPENAI_API_KEY` and setting `MARKETING_HUB_DEMO_MODE=false` in `.env.local`, run:

```bash
npm run benchmark:leads
```

The bounded five-lead benchmark uses the real staged research pipeline in an isolated `.marketing-hub-benchmark` database with no workspace context or prior leads. It fails unless the result meets explicit qualified-yield, evidence, uniqueness, contactability, customer-segment diversity, sales-motion diversity, and sales-readiness thresholds. It never prints the API key, raw provider output, or saved workspace material.

After validator or scoring changes, rerun the saved provider response without another API request:

```bash
npm run benchmark:leads:revalidate
```

## OpenAI configuration

Defaults are centralized and can be overridden:

```bash
OPENAI_TEXT_MODEL=gpt-5.6
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_API_KEY=
MARKETING_HUB_CONTEXT_DIR="/absolute/path/to/context assets"
AGI_SUMMIT_SITE_DIR="/absolute/path/to/downloaded AGI Summit site"
```

Two key paths are supported:

1. Enter a temporary key in Settings. An explicit connection test makes a small Responses request. The raw key then lives only in backend process memory behind an opaque HttpOnly, SameSite=Strict cookie and disappears on disconnect, expiration, or server exit.
2. Launch the app with `OPENAI_API_KEY` already in the environment. The browser receives only the connection source and masked suffix.

The browser never calls OpenAI. The application never writes a UI-entered key to SQLite, files, browser storage, HTML, URLs, logs, or exports. Selected context is sent only after a user starts an AI operation.

## Local data

The default data directory is `.marketing-hub/`. Override it before launch:

```bash
MARKETING_HUB_DATA_DIR=/absolute/path/to/marketing-hub-data npm run dev
```

The directory contains SQLite, uploaded visual assets, generated graphics, exports, and temporary image files. Its active path is visible in Settings and is ignored by Git. All PNG, JPEG, and WebP image responses pass through the local C2PA stripper. Newly generated campaign and Speaker Spotlight files are also stripped before they are saved; the UI labels stripped image outputs and responses include `X-Content-Credentials: removed`.

Delete individual records from their workflow pages. Reset all application records and assets inside the configured directory with:

```bash
npm run data:reset
```

Settings also has a two-step reset confirmation. Neither reset path deletes outside `MARKETING_HUB_DATA_DIR`.

## Context workflow

1. Open Context Library. In non-demo mode, Markdown/text files in `MARKETING_HUB_CONTEXT_DIR` (default: `assets for context`) are imported and kept in sync by content hash.
2. Paste or upload any `.md`/`.txt` resource. There is no fixed context-type enum: use automatic classification or enter any custom category.
3. Review inferred summaries, tags, platforms, workflow purposes, active state, and source-of-truth status. `agi summit information (1).md` is recognized as the primary AGI Summit source.
4. AI forms default to automatic relevance selection. A manual override remains available for deliberately pinned context.
5. Content generation prefers relevant local platform guidance. When a requested platform lacks local guidance, live mode uses web search only for current platform writing/image practices; local event facts remain authoritative.
6. Add optional PNG, JPEG, or WebP brand assets for general campaign graphics.

Rendered Markdown is sanitized. Uploaded content is untrusted reference material and cannot override system, evidence, schema, or approval rules.

## Lead research and outreach

1. Open Summit sales leads and configure the region, customer segments, sales paths, qualification floor, categories, roles, date range, result cap, and selected event context.
2. Start a bounded research run. Live mode performs a broad segmented discovery pass, enriches an oversized candidate pool from official sources, computes a deterministic 100-point sales score, removes prior canonical prospects, and runs a targeted backfill pass when the qualified list is short.
3. Work the priority-ranked queue. Each lead separates evidence confidence from sales value and shows its audience, sales motion, score breakdown, contact path, outreach angle, and next best action.
4. Record review or rejection reasons. Aggregate prior decisions steer later research without becoming factual evidence.
5. Select leads and create adaptive outreach that changes its request for direct tickets, group attendance, employer learning budgets, education distribution, audience sharing, cross-promotion, or sponsorship.
6. Export selected, priority-ranked sales intelligence to CSV. Emails without exact source-backed evidence are withheld from the export while contact pages, score details, sales angles, and source URLs remain available.
7. Edit each preview and mark eligible recipients reviewed.
8. Copy addresses or download the reviewed UTF-8 mail-merge CSV.

Marketing Hub never guesses an email. A model-suggested address without an exact accepted supporting URL is removed. Contact-page-only opportunities remain useful. No sending provider exists in this MVP.

## Content workflow

1. Open Content and enter the campaign brief, objective, audience, CTA, phrases, visual direction, platforms, and selected context.
2. Generate distinct X, LinkedIn, and Instagram drafts.
3. Edit the hook, post, call to action, hashtags, image text, and alt text; then save, review, copy, or regenerate one platform independently.
4. Generate a text-free campaign background or reuse a prior background.
5. Edit exact headline, subheadline, CTA, optional logo, and logo placement.
6. Download the application-composited PNG.

OpenAI image generation never owns important typography. Sharp renders exact text and branding after the background is generated. Saved text survives an image failure.

## Speaker Spotlight workflow

1. Open Speaker Spotlight and enter one or more names, one per line or comma-separated.
2. The backend dynamically locates the downloaded `index-*.js` bundle, parses matched profile records without evaluating downloaded JavaScript, and preserves verified wording.
3. It locates a downloaded headshot by name or an explicit extraction-guide/live-page `alt` mapping. Images are decoded and dimension-checked. Live visual checking blocks only when no human face is discernible; masking, cutout, framing, resolution, and other cosmetic concerns are preserved as non-blocking warnings.
4. It derives any organization wording from the verified profile so personalized role and credential copy stays grounded, while the Bay AI Circle and AGI Summit logos remain fixed template elements.
5. Each speaker gets an isolated local package with profile JSON, original headshot, image prompt, first 1024×1536 PNG, post Markdown, and a validation record. A batch manifest records every status and error.
6. Live mode makes one Image API edits request per speaker using `gpt-image-2`, high quality, exact `1024x1536` sizing, and two ordered inputs: the canonical Yuandong Tian Palace of Fine Arts poster as the edit target, followed by the verified speaker headshot as the identity reference. The prompt preserves the diagonal split, fixed summit logos and headline, neon event badge, and faded Palace backdrop while replacing the portrait and speaker-specific copy. The service restores the fixed branding regions from the canonical template after generation. The first successfully decoded 1024×1536 PNG is final; there is no generated-card vision-QA call or automatic image retry loop.
7. If the provider fails, times out, is canceled, or returns a malformed file, the verified partial package is preserved for an explicit manual retry. One factual cross-platform caption is generated from the supplied examples and campaign configuration. One speaker failure never cancels the rest of the batch.

Outputs live under `MARKETING_HUB_DATA_DIR/speaker_spotlights/<batch-id>/<speaker-slug>/`. The downloaded-site path and campaign values are configurable in the page; `AGI_SUMMIT_SITE_DIR` supplies the default path.

## Production build and local start

```bash
npm run build
npm run start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Production start is also loopback-only.

## Validation

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
npm run verify
```

The Playwright configuration starts an isolated deterministic demo server on `127.0.0.1:3100`, so it cannot accidentally reuse a non-demo development process on port 3000. Automated tests use only deterministic mocks. See [manual OpenAI verification](docs/manual-openai-verification.md) for the separate, explicitly billable live-provider check.

Tests that parse the separately downloaded AGI Summit site are skipped when `AGI_SUMMIT_SITE_DIR` is unavailable. Set that variable to run the full Speaker Spotlight integration and browser coverage; no downloaded speaker bundle or headshot is committed to this repository.

## Known limitations

- One local user and workspace; there is no authentication or remote access.
- Background work is process-local, globally serialized, and cannot survive Node process exit; unfinished rows become retryable `interrupted` records at restart.
- Active cancellation uses provider abort signals and stage checkpoints, but a provider may finish its current response before stopping. Completed composite sub-results are preserved.
- Search evidence can become stale; source links and retrieval timestamps remain visible for review.
- Live model availability, quota, and image-organization verification depend on the key owner’s OpenAI account.
- No mail sending, follow-up automation, social publishing, scheduling, analytics, or deployment configuration is included.
