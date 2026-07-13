# AI prompts and provider behavior

## Versions and models

Prompt versions are centralized in `src/lib/config.ts` and saved with their runs:

- `lead-research-v2-auto-context`
- `outreach-v2-auto-context`
- `social-content-v2-auto-context`
- `campaign-image-v1`
- `speaker-spotlight-v5-split-editorial-poster`

`OPENAI_TEXT_MODEL` defaults to `gpt-5.6`; `OPENAI_IMAGE_MODEL` defaults to `gpt-image-2`. Research uses medium reasoning. Routine outreach, social copy, Speaker Spotlight captions, and source-headshot validation use low reasoning. Responses set `store: false`.

## Trust boundary

Every text prompt separates application policy, user workflow configuration, uploaded reference documents, web evidence, and the strict output schema. Uploaded documents and web pages are explicitly untrusted reference data. Instructions inside them cannot override security, approval, schema, evidence, or non-sending boundaries.

Prompts forbid secret disclosure, local-file access, code execution, arbitrary external actions, email sending, social publishing, inferred emails, and unsupported facts. Missing event facts remain placeholders with warnings.

## Lead schema and sources

The Zod research schema requires organization/event identity, geography, nullable event and contact fields, recommended action, fit explanation, evidence, confidence, verification status, warnings, and supporting sources. All nullable fields remain required in the JSON schema so absence is explicit.

The backend independently validates output. An email is accepted only when:

1. syntax is valid;
2. an exact email-source URL is present;
3. that URL is among the accepted supporting sources;
4. the URL is public HTTP(S);
5. consumer-domain policy is satisfied or a manual-review warning is attached.

Structured schema adherence does not prove factual correctness; source links and human review remain mandatory.

## Writing prompts

Outreach may use selected context, stored lead facts, source-backed claims, and user campaign instructions. It may not invent event facts, relationships, recipient interest, scarcity, pricing, speakers, sponsors, or partnerships.

Social generation creates one concept but distinct platform posts. Automatically selected local platform guidance is the primary style authority. When live mode has no relevant local guide for a requested platform, web search supplies current platform practices and the result is marked `web_research`; demo mode uses `fallback`. Platform character limits and image presets are typed application configuration, not scattered prompt literals.

Speaker Spotlight separates identity, style, and facts. The first image is explicitly the identity reference, the second is the canonical 2:3 split-panel editorial layout/style reference, and every visible field is frozen before generation. Example-speaker identity, wardrobe, and facts are prohibited. Caption examples control only tone and structure. The source headshot is checked before generation, and the caption is structurally validated. The first generated poster is final once it decodes as the requested 1024×1536 PNG; there is no generated-card vision-QA prompt or automatic image retry.

## Image prompt

The image service appends an invariant requirement for a text-free background: no words, letters, numbers, logos, watermarks, signage, or pseudo-text, with negative space for application typography. Exact text and logo placement happen afterward in Sharp.

## Failures

Provider errors map to sanitized invalid-key, rate/quota, model access, organization verification, network, timeout, malformed output, refusal, and unavailable-provider states. Only transient failures receive the SDK’s single bounded retry. Secrets and raw provider payloads are not returned to the UI.
