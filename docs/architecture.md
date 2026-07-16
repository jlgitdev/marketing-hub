# Architecture

## Local application boundary

The browser connects to one Next.js Node process on `127.0.0.1`. React components call same-origin route handlers. Route handlers validate requests and call domain services; only the server imports the OpenAI SDK, SQLite driver, Sharp, filesystem, or key store.

```text
Browser UI → localhost route handlers → process-local AI operation queue → domain services
                                                                     ├─ SQLite repository
                                                                     ├─ local asset storage
                                                                     └─ OpenAI or deterministic demo provider
```

There is no deployment configuration, authentication, hosted database, object store, cloud queue, analytics, or general web crawler.

## Background AI operations

Every long-running AI route validates the request, creates an `ai_operations` row, places a process-local queue item in memory, and returns `202 { operation }` before provider work begins. The queue runs one global operation at a time; Speaker Spotlight retains two-speaker concurrency inside its active batch. Duplicate active work for the same target is rejected.

SQLite stores the operation kind, label, honest stage timeline, optional countable progress, result link, sanitized retry controls, errors, and timestamps. It does not store API keys, key-session IDs, selected document bodies, provider responses, or browser secrets in operation rows. Public operation responses omit the validated retry input entirely.

The browser polls once per second while work is active, once per ten seconds while idle, and immediately on focus. Because progress lives in SQLite, navigation and reload restore the current stage. Workspace data refreshes at terminal transitions and during Speaker Spotlight batches so individual completed speakers appear without waiting for the batch.

The active operation owns an `AbortController`. Queued cancellation is immediate; active cancellation aborts supported provider requests and prevents later stages or writes at reporter checkpoints. Composite work keeps completed platform drafts or speaker packages. If the Node process exits, unfinished rows become retryable `interrupted` records on the next startup; in-memory work itself cannot survive a process exit.

## SQLite and assets

Node's built-in synchronous SQLite driver applies versioned migrations at startup and enables WAL plus foreign keys. The schema persists context/import metadata, brand assets, research runs/sources, leads/source joins, outreach campaigns/recipients, content campaigns/posts, Speaker Spotlight batches/results, generated assets, and activity events. Useful lookup fields have indexes.

Binary files live beneath the configured data directory. Database rows hold safe generated names and internal paths. Asset routes resolve IDs from SQLite and refuse paths outside the configured root. Image writes use UUID names; accepted formats are decoded by Sharp before storage. Speaker headshots and cards are served through opaque asset IDs.

## Flexible context retrieval

Project Markdown/text assets are content-hash imported with origin metadata and a deletion tombstone. Filename and contents produce an open category string, summary, tags, platform hints, and workflow-purpose hints; no application enum limits categories. Each workflow ranks active documents against its purpose, requested platforms, and request text while strongly preferring a source of truth. Selected document IDs are saved with every run, and manual selection remains available as an override.

For social content, selection also reports requested platforms without matching local guidance. Only those platforms enable Responses web search for current writing and visual practices. Web guidance cannot override local event facts.

## API-key session

A submitted key is validated by a small, current Responses request. A cryptographically random opaque ID is placed in an HttpOnly, SameSite=Strict cookie. Only the backend Map holds the key, suffix, and expiration. Disconnect deletes the Map entry and cookie. Process exit naturally destroys the Map. `OPENAI_API_KEY` is a read-only environment fallback.

Queued operations hold only the opaque session reference in process memory and resolve the raw key immediately before execution. Disconnecting prevents queued work from resolving the key; the resulting operation is retryable after reconnecting. A provider call that already started may finish with the key it resolved at its start. Connection testing remains synchronous because its response establishes the HttpOnly cookie.

## OpenAI service layer

Model selection, timeouts, retries, provider error mapping, prompts, schemas, and SDK initialization are centralized under `src/server/ai`. Text workflows use Responses with `store: false` and Zod-backed Structured Outputs. Lead discovery adds the current `web_search` tool and complete source inclusion. One-shot campaign backgrounds use the Image API.

Speaker Spotlight uses the Image API edits endpoint with two ordered inputs: the canonical Yuandong Tian Palace of Fine Arts poster as the edit target and a verified current-speaker headshot as the identity reference. Any organization wording is derived from the verified speaker profile, but organization logos are not placed into the poster; the Bay AI Circle and AGI Summit lockups remain fixed in the template. Each request uses `gpt-image-2`, `1024x1536`, PNG, and high quality. The canonical layout has a white-left/near-black-right diagonal split, the fixed “THE WORLD’S LARGEST AI SUMMIT” headline, a neon event badge, a faded Palace of Fine Arts behind the portrait, three personalized credential rows, an ABOUT block, and lower-right speaker details. After generation, Sharp restores the fixed upper-left branding/headline region and upper-right badge directly from the canonical template. The service makes exactly one image request per run and accepts the first output after Sharp confirms that it decodes as a 1024×1536 PNG. It does not send the generated card to a vision model, score subjective layout or copy details, or automatically generate replacement attempts. Provider failures and malformed files preserve the verified package for an explicit user retry. Caption generation remains a separate structured Responses request using only verified profile data, campaign configuration, and supplied examples.

The deterministic demo provider implements the same domain outputs without initializing a network client. Fixtures are fictional and use reserved `.example` sources. Controlled provider and image failures exercise inspectable error states without replacing earlier successful work.

## Research and source preservation

1. Validate and snapshot selected local context IDs, summit-sales segments, sales motions, qualification floor, and settings.
2. Perform a bounded breadth-first discovery search across AI professionals, employers, founders, research and education institutions, college-prep/STEM programs, communities, associations, accelerators, and relevant events.
3. Rank and diversity-balance discovery candidates, then enrich an oversized pool in bounded batches with official identity, audience, contact, timing, and sales-motion evidence. A malformed batch is isolated so valid batches survive and shortage backfill can recover it.
4. Capture URL annotations and `web_search_call.action.sources`, parse the strict schema, and reject non-public or provider-unobserved sources.
5. Recompute contact verification independently, remove any email whose accepted source claim does not repeat the exact address, and retain official contact pages.
6. Normalize names, domains, URLs, dates, and emails; enforce selected opportunity classes, segments, sales motions, exclusions, date bounds, and future-event rules.
7. Compute a deterministic 100-point priority from audience fit, revenue potential, distribution, contactability, local relevance, timing, and evidence quality. Model confidence remains a separate evidence label.
8. Deduplicate by canonical organization/event identity within and across runs. Shared platform hosts such as Meetup and Eventbrite never act as organization identities without a matching group path or distinctive name. If the qualified novel list is short, issue one targeted backfill search excluding prior identities.
9. Persist qualification components, next action, outreach angle, review/rejection feedback, original sanitized provider output, source joins, prompt version, and per-pass usage metadata.

The UI presents evidence in an expanded source section, not only a tooltip. Manual edits remain separate in `user_edits` and never acquire source-backed status automatically.

## Outreach boundary

Outreach generation receives only selected context and stored/source-backed lead facts. No sending implementation exists. The service returns master copy and recipient drafts; reviewed recipients with source-backed emails can be exported through a spreadsheet-safe CSV encoder. The same encoder supports a separate selected-lead intelligence export containing qualification and source fields, but removes any email that is not source-backed. `email-delivery.ts` defines the narrow shape a future approved provider would implement, but this repository contains no implementation, credentials, scheduler, or Send control.

## Campaign images

The provider creates a text-free base image only after explicit action. The original background remains immutable. Sharp resizes to typed platform presets and composites bounded, wrapped, escaped SVG typography plus an optional validated raster logo in a user-selected corner. Re-rendering can reuse a saved background without another API call.
