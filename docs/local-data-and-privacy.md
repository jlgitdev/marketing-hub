# Local data and privacy

## What stays local

SQLite records, sanitized AI-operation status/retry controls, Markdown/text context, uploaded visual assets, downloaded-site profile extracts, copied headshots, Speaker Spotlight manifests/prompts/QA, generated graphics, outreach drafts, social drafts, source metadata, and exports remain under `MARKETING_HUB_DATA_DIR` on the local device. Marketing Hub contains no analytics, tracking pixels, telemetry, crash reporting, hosted persistence, or remote application server.

Generated PNG files are stripped of C2PA Content Credentials before local persistence. Every PNG, JPEG, or WebP returned by an image endpoint is stripped again at the response boundary, including legacy files and previews of source assets. Stripping removes PNG `caBX`, JPEG C2PA APP11/JUMBF, and WebP `C2PA` blocks without re-encoding image pixels. Image cards show a `C2PA stripped` badge, and responses include `X-Content-Credentials: removed`.

Operation persistence contains validated user controls and local entity IDs so failed or interrupted work can be retried. It excludes raw API keys, key-session IDs, selected context bodies, provider responses, and authorization data. Operation API responses also omit the stored retry payload. Secret-shaped text is redacted before persistence as a defense in depth.

## What is sent to OpenAI

Nothing is sent when context is uploaded, imported, pasted, edited, viewed, ranked, or selected. After an explicit AI action, the server sends only the automatically or manually chosen context plus the workflow request. Live research allows OpenAI’s hosted web-search tool to access public web information. Live social content uses web search only when requested platform guidance is missing locally. General campaign image generation sends the selected visual prompt; exact overlay text is rendered locally afterward.

An explicit live Speaker Spotlight action sends the verified speaker profile and caption examples for caption generation, checks the selected source headshot as a usable portrait, and sends the verified headshot plus supplied design reference to GPT Image 2. The generated card is not sent back to a vision model for QA. Those images are not sent merely by opening the page or entering names. Responses requests use `store: false`; Image API handling follows the OpenAI API account's data controls.

Demo mode sends nothing externally.

## API key handling

A key entered in Settings is transmitted once from the loopback browser to the loopback backend for an explicit connection test. The raw value is held only in backend process memory. The cookie contains a random opaque session ID, never the key. The browser receives connection status and at most a short suffix.

The raw key is not written to SQLite, files, environment files, browser storage, page HTML, URLs, logs, generated content, exports, or test snapshots. Disconnect, expiration, or server exit clears the temporary session. An operator-provided `OPENAI_API_KEY` remains the responsibility of the launching shell and is never exposed to the browser.

The local operation queue keeps only an opaque temporary-session reference until a queued operation begins. It resolves the key from volatile backend memory immediately before provider execution. Disconnecting therefore prevents queued operations from starting with that session. An already-running provider call may finish with the in-memory key it resolved before disconnect; cancellation is requested through an `AbortController`, but provider cancellation timing is not guaranteed.

## Navigation, cancellation, and restart recovery

AI work continues in the local Node process when the user changes screens or reloads the browser. The UI restores progress from SQLite and never requires the page that initiated the request to stay mounted. This is not a durable cloud worker: closing or restarting the Node process stops in-flight work. On next startup, unfinished operations are labeled `interrupted`, preserve completed durable sub-results, and can be retried after connection and entity preflight.

## Deletion

Individual records and assets can be deleted in their workflow. Settings provides a two-step full reset. The command-line equivalent is:

```bash
npm run data:reset
```

Both reset paths operate only inside the configured data directory. Back up the directory yourself if retention is needed.

## Contact data

The application stores only deliberately published professional/organizational contact information supported by a public URL. It excludes guessed addresses, mail-pattern inference, data brokers, leaks, attendee lists, and private member data. Contact-page-only leads are retained without fabricating an email. Users remain responsible for applicable outreach, consent, and opt-out obligations.
