# Marketing Hub

Marketing Hub is a local AI workspace for running an event-marketing program from source material to finished campaign assets. It brings event context, lead research, outreach drafts, social content, speaker posters, and live agenda graphics into one reviewable workflow.

It is intentionally local-first:

- the app binds to `127.0.0.1`;
- work is stored in local SQLite databases and folders;
- the browser never talks to OpenAI directly;
- no email is sent and no social post is published; and
- deterministic demo mode works without a key or network access.

## Quick start

Requirements:

- Node.js 22 or newer
- npm 10 or newer
- a current Chrome, Safari, Firefox, or Edge browser

Install dependencies and start the app in demo mode:

```bash
npm ci
MARKETING_HUB_DEMO_MODE=true npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

Demo mode is the best way to explore the product. It uses deterministic fixtures, makes no external requests, and does not require an OpenAI API key. Its organizations, contacts, and `.example` sources are fictional.

To keep demo mode enabled between launches, copy the example environment file and edit `.env.local`:

```bash
cp .env.example .env.local
```

```dotenv
MARKETING_HUB_DEMO_MODE=true
```

The database and required asset directories are created automatically on first launch. `npm run db:init` is available when you want to initialize them explicitly.

## Run with OpenAI

Set `MARKETING_HUB_DEMO_MODE=false`, start the app, and connect a key in **Settings**. The connection test makes a small billable Responses API request. A key entered in the UI is held only in server-process memory and is lost when it is disconnected, expires, or the server stops.

Alternatively, provide the key to the server at launch:

```dotenv
OPENAI_API_KEY=sk-...
MARKETING_HUB_DEMO_MODE=false
```

The default models are `gpt-5.6` for text and `gpt-image-2` for images. Both can be changed with environment variables.

Live research uses OpenAI web search and live creative workflows use the Images API, so usage is billed to the supplied key. Uploaded or imported context is not sent anywhere merely because it was added to the library; it is sent only after you explicitly start a relevant AI action.

## What is included

| Area | What it does |
| --- | --- |
| **Overview** (`/`) | Shows the active workspace, next actions, recent output, and operation status. |
| **Assistant** (`/assistant`) | Answers questions from saved event context, creates a post and matching graphic, or turns pasted/uploaded material into reusable context. |
| **Context** (`/context`) | Imports, classifies, edits, and activates Markdown/text references and visual brand assets. Documents can be marked as a source of truth. |
| **Leads** (`/leads`) | Finds source-backed ticket, group-sales, distribution, partnership, and sponsorship opportunities; scores them; preserves evidence; and prepares outreach. |
| **Content** (`/content`) | Turns a plain-language campaign brief into editable platform copy and a finished one-shot campaign graphic. |
| **Speaker Spotlight** (`/speaker-spotlight`) | Analyzes reusable poster templates and creates a verified poster-and-caption package for each speaker. |
| **Live Agenda** (`/summit-agenda`) | Presents the event schedule as a timeline, lets operators correct session data and portraits, and generates a live social graphic and caption for selected sessions. |
| **Runs** (`/runs`) | Reopens saved research and content work. |
| **Settings** (`/settings`) | Manages the temporary OpenAI connection, shows the active data path, and resets the active workspace. |

### A typical workflow

1. Create or select a workspace.
2. Add the event brief, approved facts, audience, voice, platform guidance, logos, and visual references in **Context**.
3. Use **Assistant** for quick grounded questions and one-off creative work.
4. Use **Leads** for evidence-backed prospecting, review, outreach drafting, and CSV export.
5. Use **Content**, **Speaker Spotlight**, and **Live Agenda** for campaign and event-day creative production.
6. Review every draft in the app, then copy or download it for use in an external sending or publishing tool.

The application treats generation as a draft-production step, not approval. Copy, contact data, source claims, names, portraits, and generated artwork should all receive human review.

## Workspaces and local data

Each workspace isolates its context, assets, leads, campaigns, assistant history, poster templates, agenda state, and activity. New workspaces start with an empty agenda and their own data directory. The original AGI Summit workspace uses the root data directory for backward compatibility.

By default, data lives under `.marketing-hub/`:

```text
.marketing-hub/
├── marketing-hub.sqlite        # original workspace database
├── workspaces.json             # local workspace registry
├── generated/                  # campaign graphics
├── speaker_spotlights/         # speaker packages and manifests
├── speaker_spotlight_templates/
├── summit_agenda/              # agenda state, portraits, and batches
└── workspaces/<workspace-id>/  # data for additional workspaces
```

Change the root before starting the app:

```bash
MARKETING_HUB_DATA_DIR=/absolute/path/to/marketing-hub-data npm run dev
```

Back up that directory if you need retention. **Settings → Reset this workspace** and `npm run data:reset` remove the active workspace's records and assets; there is no undo. Deleting a workspace removes only that workspace.

All saved or served PNG, JPEG, and WebP outputs pass through the local C2PA metadata stripper.

## Context and event source files

In live mode, the original AGI Summit workspace imports Markdown and text files from `MARKETING_HUB_CONTEXT_DIR` by content hash. The default is `./assets for context`. Additional workspaces stay isolated and do not automatically inherit those project files. In any workspace, you can paste material or upload `.md` and `.txt` files in the UI.

Context selection is automatic by default and considers the workflow, prompt, platform, active state, and source-of-truth status. Manual selection remains available when a campaign must use specific references. Rendered Markdown is sanitized, and imported material is treated as untrusted reference text rather than executable instruction.

Speaker Spotlight can extract verified profiles and headshots from a separately downloaded AGI Summit site package. Put the merged package at `./agi-summit-site` or set `AGI_SUMMIT_SITE_DIR` to its absolute path. That package is intentionally not committed. See [Sharing the Speaker Spotlight project](docs/sharing-speaker-spotlight-project.md) for the handoff format.

The default workspace's Live Agenda source data, portraits, and layout references are committed under `src/data/` and `public/summit-agenda/`. Newly created workspaces begin without sessions and must be populated with their own program data and portraits.

## Background operations and failure recovery

Long-running research, outreach, content, Speaker Spotlight, and agenda jobs return immediately and run through a process-local queue. The activity dock and inline operation cards show real stages, cancellation, retry state, and result links across navigation and browser reloads. Numeric progress is shown only when the work has countable units.

Operation history is durable, but the worker is not: stopping the Node process interrupts active work. On restart, unfinished operations are marked `interrupted` and can be retried. Completed platform drafts, speaker results, and other durable partial output are preserved when possible.

## Configuration

All supported environment variables are documented in `.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | unset | Server-side key. The temporary Settings connection can be used instead. |
| `OPENAI_TEXT_MODEL` | `gpt-5.6` | Text and structured-output model. |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` | General image model. Specialized poster flows currently target GPT Image 2. |
| `MARKETING_HUB_DEMO_MODE` | `false` | Enables deterministic, network-free providers. |
| `MARKETING_HUB_DEMO_DELAY_MS` | `0` | Adds a delay before demo operations for progress-state testing. |
| `MARKETING_HUB_DATA_DIR` | `./.marketing-hub` | Root for databases, uploads, generated files, and exports. |
| `MARKETING_HUB_CONTEXT_DIR` | `./assets for context` | Directory automatically imported as project context in live mode. |
| `AGI_SUMMIT_SITE_DIR` | `./agi-summit-site` | Downloaded site package used for Speaker Spotlight profile and headshot extraction. |

Do not commit `.env.local`; environment files other than `.env.example` are ignored by Git.

## Privacy and product boundaries

- The Next.js server listens on loopback, not `0.0.0.0`.
- The raw API key is never returned to the browser or written to SQLite, exports, logs, URLs, or browser storage.
- Responses API calls use `store: false`.
- Marketing Hub contains no analytics, telemetry, cloud database, hosted queue, or deployment configuration.
- Research retains public source URLs and retrieval metadata. It does not use private attendee lists, leaked data, data brokers, or guessed email patterns.
- An email is considered source-backed only when an accepted public source contains that exact address. User edits remain visibly distinct from verified evidence.
- Outreach is draft-and-export only. There is no sending provider, scheduler, or follow-up automation.
- Social output is copy-and-download only. There is no publishing integration.

Users remain responsible for factual review, consent, opt-out handling, platform policy, and applicable marketing law.

## Development

Useful commands:

```bash
npm run dev                 # development server on 127.0.0.1:3000
npm run lint                # ESLint
npm run typecheck           # TypeScript without emitting files
npm run test                # deterministic Vitest suite
npm run test:watch          # Vitest watch mode
npm run test:e2e            # Playwright against an isolated demo server on :3100
npm run agenda:verify       # validate committed agenda data and assets
npm run build               # production build
npm run verify              # agenda, lint, types, unit/integration tests, and build
```

Automated tests use deterministic providers and do not spend API credits. Playwright uses isolated `.marketing-hub-e2e` and `.next-e2e` directories and will not reuse a development server on port 3000.

For a local production build:

```bash
npm run build
npm run start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Production start remains loopback-only.

### Live lead-quality benchmark

The benchmark exercises the real five-lead research pipeline in an isolated `.marketing-hub-benchmark` database. It requires a live key and consumes API credits:

```bash
npm run benchmark:leads
```

It fails when results miss the configured thresholds for qualified yield, evidence, uniqueness, contactability, customer-segment diversity, sales-motion diversity, or sales readiness. After changing validation or scoring logic, re-check the saved provider response without another request:

```bash
npm run benchmark:leads:revalidate
```

## Architecture

```text
Browser
  └─ Next.js route handlers on 127.0.0.1
       ├─ domain services and process-local operation queue
       ├─ workspace-scoped SQLite and local asset storage
       └─ deterministic demo provider or server-side OpenAI client
```

The app uses Next.js, React, TypeScript, Node's built-in SQLite driver, Zod, Sharp, Vitest, and Playwright. The main code boundaries are:

- `src/app/` — pages and same-origin API route handlers
- `src/components/` — client workflows and shared application UI
- `src/server/services/` — domain workflows
- `src/server/ai/` — prompts, schemas, provider calls, retries, and timeouts
- `src/server/db/` — SQLite migrations and repositories
- `src/server/storage/` — local asset validation and persistence
- `tests/` and `e2e/` — deterministic service, integration, and browser coverage

## Known limitations

- This is a local operator tool, not a hosted multi-user product. It has no authentication or remote-access controls.
- The operation queue is process-local and globally serialized; in-flight work cannot survive a Node process exit.
- Provider availability, model access, quotas, latency, and image-generation permissions depend on the key owner's OpenAI account.
- Public-web evidence can become stale. Review the stored sources and timestamps before acting.
- Generated typography, faces, logos, and factual details can be imperfect. The app deliberately preserves first-pass results instead of silently spending credits on automatic aesthetic retries.
- The separately downloaded Speaker Spotlight site package is required for live profile extraction and is not part of this repository.
- Email sending, social publishing, scheduling, analytics, and deployment are outside the current scope.
