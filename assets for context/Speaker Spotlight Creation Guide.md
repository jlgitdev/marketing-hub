# Speaker Spotlight Creation Guide

## Purpose

This guide defines the complete production workflow for creating AGI Summit speaker spotlight packages from a user-supplied list of speaker names.

The workflow accepts any positive number of names. For every speaker, it must:

1. Extract and verify the speaker's AGI Summit profile data.
2. Find and verify the correct headshot.
3. Use the OpenAI Image API with `gpt-image-2` to create a personalized speaker spotlight graphic.
4. Make the graphic look as close as possible to `speaker spotlight social media image reference v2.png`, while replacing Marco Pavone, NVIDIA, and all example-specific content with the current speaker's verified identity, organization logo, and condensed information.
5. Produce the final graphic at an exact **2:3 aspect ratio**.
6. Write the accompanying social post using `speaker_spotlight_text_example.md` as the style and structure reference.
7. Validate every output and clearly report failures instead of inventing or guessing information.

This is intended to be implemented as a backend workflow for a website using the OpenAI API. The OpenAI API key must be stored on the server and must never be exposed in browser-side code.

## Required source files

The workflow uses these files as its local sources of truth:

- `agi-summit-speaker-extraction-guide.md`
- `speaker spotlight social media image reference v2.png`
- `speaker_spotlight_text_example.md`

Configure the downloaded AGI Summit site with `AGI_SUMMIT_SITE_DIR`. For example:

```text
/absolute/path/to/downloaded-agi-summit-site/
```

The downloaded site path must be configurable in the website implementation. A hosted server cannot directly access a path on a user's Mac, so the production system must either:

- import the downloaded site bundle and images into server-accessible storage;
- accept an uploaded site archive; or
- run locally on the same machine as the downloaded site.

Do not silently replace the downloaded-site workflow with unverified web search results.

## Inputs

### Required inputs

```json
{
  "speaker_names": [
    "Speaker One",
    "Speaker Two"
  ]
}
```

Rules:

- `speaker_names` may contain one name or many names.
- Remove leading and trailing whitespace.
- Reject empty strings.
- Remove exact duplicate names after trimming.
- Preserve the user's original spelling for display and reporting.
- Process each speaker independently so one failure does not cancel the remaining speakers.

### Recommended configurable campaign values

```json
{
  "event_name": "AGI Summit SF 2026",
  "event_dates": "July 18–19, 2026",
  "event_venue": "Palace of Fine Arts, San Francisco",
  "event_website": "agisummit.ai",
  "ticket_url": "https://luma.com/agisummit2026?coupon=JAMES",
  "discount_copy": "15% off automatically applied through the link"
}
```

Campaign values must come from configuration, not from model memory. Changing the ticket link, coupon, date, venue, or event language should not require changing the generation prompts in application code.

## Final deliverables

Create a separate directory for each speaker:

```text
output/speaker_spotlights/<speaker-slug>/
```

Each successful speaker directory should contain:

```text
<speaker-slug>-headshot.<original-extension>
<speaker-slug>-profile.json
<speaker-slug>-image-prompt.md
<speaker-slug>-speaker-spotlight.png
<speaker-slug>-post.md
<speaker-slug>-qa.json
```

Also create a batch manifest:

```text
output/speaker_spotlights/manifest.json
```

The manifest should record, for each requested name:

- original input name;
- normalized profile key;
- final status;
- output paths;
- verification results;
- API request IDs when available;
- retry counts;
- error details when unsuccessful.

Suggested statuses:

```text
queued
extracting
extraction_failed
ready_for_image
generating_image
image_review_required
writing_post
completed
failed
```

## Non-negotiable accuracy rules

1. Never invent a title, employer, credential, statistic, affiliation, social handle, highlight, or URL.
2. Treat the downloaded AGI Summit record as the primary source for speaker facts.
3. Preserve original capitalization, punctuation, numbers, and Unicode characters during extraction.
4. A missing fact must be omitted or marked as unavailable.
5. Do not infer that an opaque image belongs to a speaker based only on directory order.
6. Visually inspect every selected headshot before using it.
7. The example spotlight image controls visual style and layout; it does not supply facts for another speaker.
8. Do not let text or identity from the example speaker appear in another speaker's output.
9. The final image must be exactly 2:3.
10. Any output with a misspelled speaker name, incorrect fact, wrong person, clipped text, or wrong aspect ratio must be rejected.

---

# End-to-end workflow

## Stage 1: Initialize the batch

1. Validate the list of names.
2. Create a batch identifier.
3. Create a manifest entry for every name.
4. Locate the current downloaded AGI Summit JavaScript bundle dynamically.
5. Verify that all three required reference files exist and are readable.
6. Verify that the server has an `OPENAI_API_KEY` environment variable.
7. Do not log the API key or return it to the browser.

Locate the compiled bundle by pattern instead of relying on a fixed hash:

```bash
rg --files "$AGI_SUMMIT_SITE_DIR" | rg '/index-.*\.js$'
```

The downloaded HTML file may be empty. Follow `agi-summit-speaker-extraction-guide.md` and begin with the `_files` directory.

## Stage 2: Extract one speaker's profile

Run the following steps independently for every speaker.

### 2.1 Normalize the speaker name

Create a profile key by converting the name to lowercase and removing spaces, punctuation, accents, and symbols.

Examples:

| Display name | Profile key |
|---|---|
| Joe Palermo | `joepalermo` |
| Jun Liu | `junliu` |
| Zihan (Gavin) Zheng | `zihangavinzheng` |

The normalization function is only for locating data. It must not replace the human-readable display name.

### 2.2 Find the profile record

Search the compiled bundle for the normalized key:

```bash
rg -o -i --text '.{0,200}<profile-key>.{0,3200}' "/path/to/index-bundle.js"
```

Extract all available fields:

- `sub`
- `roleLine`
- `bio`
- `highlights[].k`
- `highlights[].t`
- `stats[].v`
- `industries[]`
- `tags[]`
- `badge`
- `linkedin`
- `x`

Some title or organization information may live in the speaker-list data while richer details live in the profile record. Merge only records that clearly match the same normalized name.

### 2.3 Create a structured profile object

Normalize the extracted data into this internal shape:

```json
{
  "input_name": "Joe Palermo",
  "display_name": "Joe Palermo",
  "profile_key": "joepalermo",
  "subtitle": "Frontier Research · OpenAI",
  "role_line": "Member of Technical Staff at OpenAI — research engineer on frontier models; co-author of the GPT-4 technical report and a contributor to OpenAI o1",
  "bio": "Member of Technical Staff at OpenAI, working on frontier models.",
  "highlights": [
    {
      "label": "OpenAI MTS",
      "text": "research engineer on frontier models"
    }
  ],
  "industries": [
    "Frontier AI",
    "LLM Research",
    "Reasoning Models"
  ],
  "stats": [],
  "badge": "GPT-4 & o1",
  "linkedin_url": "https://www.linkedin.com/in/example/",
  "x_url": null,
  "x_handle": null,
  "source": {
    "bundle_path": "/absolute/path/to/index-bundle.js",
    "verified": true
  }
}
```

Do not use placeholder values in real outputs. A field that is not present should be `null` or an empty array.

### 2.4 Validate the extraction

Before continuing, confirm:

- the record key matches the requested speaker;
- the display name is correct;
- every highlight came from the matched record;
- URLs are copied exactly;
- no neighboring speaker's record was accidentally captured;
- Markdown markers such as `**` are removed only when preparing visible image copy, without changing the words.

If no reliable record is found, mark that speaker `extraction_failed` and continue with the other names.

## Stage 3: Find and verify the headshot

### 3.1 Search by name

Search downloaded assets using hyphens, underscores, spaces, partial names, and common image extensions:

```bash
rg --files "$AGI_SUMMIT_SITE_DIR" | rg -i 'first[-_ ]?last.*\.(webp|png|jpe?g)$'
```

Downloaded assets may contain an inserted suffix such as `_KJhG`.

### 3.2 Resolve opaque filenames

If no name-based match exists:

1. Open the live AGI Summit speaker page.
2. Locate the `img` element whose `alt` value exactly matches the speaker's full name.
3. Read its `src` or `currentSrc` basename.
4. Match that basename to the downloaded file, allowing for downloaded suffixes.

If the live site cannot be checked, inspect candidates visually and do not claim a match unless it can be verified.

### 3.3 Verify and copy

Check dimensions and visually inspect the image:

```bash
sips -g pixelWidth -g pixelHeight "/path/to/headshot.webp"
```

Confirm that it maps to the requested speaker and contains a discernible human face. Continue generation whenever a face is visible. Rough masking, jagged cutout edges, imperfect background removal, unusual framing, low resolution, multiple people, and other cosmetic defects should be recorded as warnings, not treated as blockers. Stop only when no human face is discernible or no speaker image can be mapped at all.

Copy the original, without altering it, to:

```text
output/speaker_spotlights/<speaker-slug>/<speaker-slug>-headshot.<extension>
```

Record how the mapping was verified: filename match, live-page `alt` match, or manual confirmation.

If no speaker image can be mapped or the mapped image contains no discernible human face, stop that speaker's image workflow and mark it for review. If the automated face check is temporarily unavailable, continue with the locally matched site headshot and record a warning.

## Stage 4: Prepare the visible card copy

The graphic should use concise text because dense paragraphs increase the risk of clipping or rendering errors.

Prepare these fields from the verified profile:

```json
{
  "name": "Full Speaker Name",
  "topic_line": "Topic One · Topic Two & Topic Three",
  "description": "One concise, factual sentence describing the speaker.",
  "topics": [
    "Topic One",
    "Topic Two",
    "Topic Three"
  ],
  "highlights": [
    "Label — Verified description",
    "Label — Verified description",
    "Label — Verified description"
  ]
}
```

Rules:

- Use no more than two concise, verified role or credential blocks below the organization logo.
- Use no more than two verified topic labels in one compact row.
- Resolve the primary company or university from the verified profile and the downloaded site's organization-brand registry.
- For a speaker with multiple affiliations, choose the organization that controls the supplied canonical reference or use an explicit reviewed override; Marco Pavone uses NVIDIA.
- Do not include an ABOUT paragraph, quote, statistics, or highlight cards in the image.
- Preserve proper nouns exactly.
- Shorten only by removing redundant wording; do not change meaning.
- Use `industries[]` and `tags[]` for the two-item topic line when available.
- Use `roleLine`, `subtitle`, and verified organization references to build the compact role blocks.

Save the final visible copy before image generation. The same frozen copy must be used for both the image prompt and image QA.

## Stage 5: Generate the speaker spotlight graphic with GPT Image 2

### 5.1 Use the correct API operation

Use the OpenAI **Image API edits endpoint**, not a text-only image generation request, because this workflow requires three image references:

1. the current speaker's verified headshot; and
2. `speaker spotlight social media image reference v2.png` as the visual style and layout reference; and
3. a locally normalized PNG of the verified company or university logo from the downloaded site's organization-brand registry.

Use:

```text
POST /v1/images/edits
model: gpt-image-2
```

The Image API supports one or more reference images for an edit/reference workflow.

### 5.2 Reference-image roles

Always send and describe the images in this order:

- **Image 1 — identity reference:** the verified headshot for the current speaker.
- **Image 2 — style/layout reference:** `speaker spotlight social media image reference v2.png`.
- **Image 3 — organization-brand reference:** the verified company or university logo/lockup for the current speaker, normalized onto a clean white canvas without changing its geometry or colors.

The prompt must explicitly state that Image 1 controls the person's identity, Image 2 controls the graphic's style and layout, and Image 3 controls the large organization branding.

The prompt must also state that Marco Pavone's identity, NVIDIA branding, Stanford copy, and all other example-specific content must not appear unless verified for the current speaker.

### 5.3 Exact 2:3 output size

Set:

```json
{
  "size": "1024x1536",
  "quality": "high",
  "output_format": "png"
}
```

`1024x1536` is exactly 2:3 and matches the tall editorial-poster proportions of the canonical reference.

Do not use `1024x1280`; that older 4:5 contract belongs to the superseded navy-and-gold card design.

Do not rely only on the words "2:3 portrait" in the prompt. Set the API `size` parameter explicitly and verify the saved file's dimensions afterward.

For `gpt-image-2`, omit `input_fidelity`; image inputs are automatically processed at high fidelity and the API does not permit changing that parameter for this model.

### 5.4 Required image prompt template

Create a separate prompt for every speaker by filling in the verified fields below.

```text
Use case: ads-marketing
Asset type: final 2:3 portrait social-media speaker spotlight poster, exactly 1024 × 1536 pixels.

Input images:
- Image 1 is the verified identity reference for {{SPEAKER_NAME}}. Preserve this person's recognizable identity, facial structure, skin tone, eyes, expression, hairstyle, wardrobe, and professional appearance faithfully. Use only this person.
- Image 2 is the canonical Marco Pavone AGI Summit speaker spotlight reference. Follow its white-left/black-right diagonal split, minimal editorial hierarchy, electric-blue accents, large stacked speaker name, large organization-logo area, top-right AGI Summit masthead, compact role lines, topic row, and icon-led event footer. Do not retain Marco Pavone, his face, NVIDIA branding, Stanford copy, or other example-specific content unless verified for the current speaker.
- Image 3 is the verified {{ORGANIZATION_NAME}} logo/lockup extracted from the downloaded AGI Summit site's organization-brand registry. Reproduce it prominently without redesigning, recoloring, distorting, or replacing it.

Primary request:
Create a personalized AGI Summit 2026 speaker spotlight poster for {{SPEAKER_NAME}}. It should look as close as possible to Image 2 while replacing all speaker-specific content with the verified identity and facts supplied below.

Exact visible text, verbatim:
"FEATURED SPEAKER"
"{{FIRST_NAME}}"
"{{REMAINING_NAME}}"
"{{ORGANIZATION_NAME}}"
"{{ROLE_BLOCK_1}}"
"{{ROLE_BLOCK_2}}"
"{{TOPIC_1}} • {{TOPIC_2}}"
"{{EVENT_DATES}}"
"{{EVENT_VENUE}}"
"{{EVENT_WEBSITE}}"

Composition:
Closely follow Image 2. Reserve roughly 40% of the canvas for the white information panel and 60% for the near-black portrait panel, separated by the reference's strong diagonal edge. Put FEATURED SPEAKER and a two-line adaptive speaker name at upper left; the large verified organization logo immediately below the name; no more than two compact role blocks and one two-topic row below the logo; the icon-led event footer at bottom left; the AGI Summit masthead at upper right; and a large three-quarter speaker portrait on the right. Keep at least 44 pixels of side margin around the name and generous clear space around the logo.

Typography:
Use bold condensed uppercase display type for headlines and the speaker name, with a clean sans-serif for detail copy. Render every word accurately and keep all copy inside safe margins.

Visual style:
Crisp premium editorial conference poster; stark white and near-black split; black text with electric cobalt-blue accents; bold condensed display type; clean sans-serif details; thin dividers; simple cobalt line icons; generous whitespace.

Constraints:
- Output must be exactly 2:3 portrait.
- Use only the verified claims supplied above.
- Preserve the speaker's identity.
- Keep all copy legible and spelled exactly.
- Keep image copy deliberately condensed: name, organization logo, up to two role blocks, up to two topics, and the event footer only.
- Do not label a speaker “KEYNOTE SPEAKER” unless that status is explicitly verified; use the supplied “FEATURED SPEAKER” label.
- Do not add an ABOUT paragraph, biography, quote, statistics, highlight cards, credentials, handles, affiliations, or organizations that were not supplied.
- Do not add a ticket URL to the image.
- No watermark, QR code, fake logo, duplicated copy, or placeholder text.
- Do not include any face, name, wardrobe, logo, or speaker-specific text from Image 2.
```

For short but difficult proper nouns, abbreviations, or model names, append spelling guidance such as:

```text
Spelling guidance:
OpenAI = O-p-e-n-A-I
GPT-4 = G-P-T hyphen 4
o1 = lowercase o followed by numeral 1
agisummit.ai = a-g-i-s-u-m-m-i-t dot a-i
```

Do not add spelling guidance that changes the visible copy. It is only an instruction to the image model.

### 5.5 JavaScript API example

```javascript
import fs from "fs";
import OpenAI, { toFile } from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function generateSpeakerSpotlight({
  headshotPath,
  styleReferencePath,
  organizationLogoPath,
  prompt,
  outputPath,
}) {
  const images = await Promise.all([
    toFile(fs.createReadStream(headshotPath), null, {
      type: "image/webp",
    }),
    toFile(fs.createReadStream(styleReferencePath), null, {
      type: "image/png",
    }),
    toFile(fs.createReadStream(organizationLogoPath), null, {
      type: "image/png",
    }),
  ]);

  const response = await client.images.edit({
    model: "gpt-image-2",
    image: images,
    prompt,
    size: "1024x1536",
    quality: "high",
    output_format: "png",
  });

  const imageBytes = Buffer.from(response.data[0].b64_json, "base64");
  fs.writeFileSync(outputPath, imageBytes);

  return {
    outputPath,
    requestId: response._request_id ?? null,
  };
}
```

Use the real MIME type for each uploaded headshot. Do not label a JPEG or PNG as WebP.

### 5.6 Generate one image per API request

For a list of speakers, make a separate, speaker-specific image request for each person. Do not ask one request to create multiple different speakers or a contact sheet.

Use bounded concurrency rather than launching every request simultaneously. Start with two or three concurrent image jobs and adjust based on the API organization's rate limits.

Save each prompt to `<speaker-slug>-image-prompt.md` before making the request.

## Stage 6: Validate the generated image

An API success response does not automatically mean the asset is approved.

### 6.1 Mechanical checks

Verify:

- the file decodes successfully;
- format is PNG;
- dimensions are exactly `1024x1536`;
- aspect ratio is exactly `2:3`;
- file size is greater than zero;
- the file is written to the correct speaker directory.

Example:

```bash
sips -g pixelWidth -g pixelHeight "/path/to/speaker-spotlight.png"
```

### 6.2 Visual and factual checks

Use visual inspection and, when available, OCR or a vision-capable QA step to verify:

- the portrait depicts the correct speaker;
- the face remains recognizable and undistorted;
- Marco Pavone and all other example-specific content are absent unless verified for the current speaker;
- the speaker's name is spelled exactly;
- the large company or university logo matches Image 3 and the verified affiliation;
- every visible fact matches the frozen card copy;
- the event date, venue, and website are correct;
- there are no more than two compact role blocks and two topic labels;
- the split white-left/near-black-right composition and diagonal divider match the reference;
- no text is clipped, duplicated, garbled, or pushed outside safe margins;
- the style closely matches the supplied example;
- no unsupported social handle, logo, statistic, or credential was added;
- no watermark or QR code is present.

### 6.3 Rejection criteria

Reject the image if any of the following is true:

- wrong person or materially changed identity;
- misspelled speaker name;
- inaccurate or invented fact;
- any remaining example-speaker face, name, logo, role, or topic;
- missing, incorrect, distorted, or invented organization branding;
- incorrect date, venue, or website;
- wrong dimensions or aspect ratio;
- unreadable, clipped, duplicated, or corrupted text;
- noticeably different visual structure from the reference;
- missing required section;
- watermark, QR code, or fake branding.

### 6.4 Retry policy

Permit up to three image attempts per speaker by default.

Each retry should address only the observed failure. Examples:

```text
Regenerate the card while keeping the same verified speaker identity and layout. Correct only the spelling of "{{SPEAKER_NAME}}" and preserve all other supplied text verbatim.
```

```text
Regenerate at exactly 1024 × 1536. Keep the name, logo, role lines, topics, and footer fully inside the safe margins.
```

```text
Use Image 1 more faithfully for facial identity. Do not alter the speaker's facial structure, eyes, hairstyle, skin tone, or expression.
```

Always submit the original verified headshot, canonical style reference, and normalized organization logo again. Do not allow previous failed output to become the only identity or brand reference.

If the image still fails after the retry limit, set the status to `image_review_required`, preserve all attempts, and continue processing other speakers.

## Stage 7: Write the social-media post

Use `speaker_spotlight_text_example.md` as the writing-style and structure reference. The examples control tone, pacing, section order, use of emoji, bullet style, event call-to-action, and hashtag pattern. They do not supply facts for the current speaker.

### 7.1 Factual inputs

Provide the text model only with:

- the verified structured profile;
- the configured campaign values;
- the contents of `speaker_spotlight_text_example.md`;
- the writing rules in this guide.

Do not ask the model to research missing facts from memory.

### 7.2 Required post structure

The finished post should generally follow this order:

```text
<relevant emoji> Speaker Spotlight: <full name>
<speaker X handle only when verified>

<short thematic opening hook>

<factual speaker introduction>

<optional second factual context paragraph>

🔹 <verified highlight>
<verified organization handle only when available>

🔹 <verified highlight>
🔹 <verified highlight>
🔹 <optional verified highlight>

<forward-looking closing paragraph connecting the speaker's work to an important AI conversation>

Hear <first name> on stage at AGI Summit SF 2026.

📅 <configured event dates>
📍 <configured venue>
🎟 Tickets: <configured ticket URL>

🏷️ <configured discount copy>

<four or five relevant hashtags>
```

### 7.3 Writing rules

- Match the professional, energetic, forward-looking voice of the examples.
- Begin with a thematic hook relevant to the speaker's work.
- Introduce the speaker clearly and early.
- Use three or four concise fact bullets.
- Make the closing paragraph connect the speaker's verified expertise to a larger AI question.
- Keep the event call-to-action and campaign values exact.
- Use the verified X handle only when one exists.
- Convert a verified X URL to a handle only when the handle can be parsed unambiguously.
- Do not invent handles for the speaker, employer, university, or organization.
- Do not use a LinkedIn slug as an X handle.
- Use four or five relevant hashtags, including `#AGISummit` or the capitalization configured by the campaign.
- Do not claim the speaker will discuss a specific session topic unless that topic is verified.
- Do not add unsupported superlatives such as "world-leading" or "pioneer."
- Avoid repeating the same fact in the introduction and every bullet.
- Preserve the spelling of companies, model names, institutions, and surnames.

### 7.4 Text-generation prompt template

```text
Write one AGI Summit 2026 speaker spotlight social-media post.

Use the supplied speaker spotlight examples only as a style, tone, pacing, and structure reference. Do not reuse facts, names, handles, employers, or hashtags from the examples unless they also appear in the verified current-speaker data.

Verified speaker data:
{{PROFILE_JSON}}

Campaign configuration:
{{CAMPAIGN_JSON}}

Requirements:
- Follow the section order and approximate length of the examples.
- Start with a relevant emoji followed by "Speaker Spotlight: {{SPEAKER_NAME}}".
- Use only verified facts.
- Include three or four verified bullet points beginning with 🔹.
- Include a verified speaker or organization X handle only when supplied.
- Never invent a handle, title, credential, statistic, affiliation, or session topic.
- Include the configured event dates, venue, ticket URL, and discount copy verbatim.
- End with four or five relevant hashtags.
- Return only the finished post, with no analysis, citations, labels, or Markdown code fence.
```

### 7.5 Responses API example

Keep the text model configurable instead of hard-coding it throughout the application:

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const response = await client.responses.create({
  model: process.env.OPENAI_TEXT_MODEL,
  input: postPrompt,
});

const post = response.output_text.trim();
```

The deployed environment must define `OPENAI_TEXT_MODEL` to a text-capable model approved for the project.

### 7.6 Validate the post

Compare the final post against the verified profile and configuration.

Reject or correct it if it contains:

- a fact not present in the source record;
- an invented or incorrect handle;
- an incorrect event date, venue, ticket link, coupon, or discount;
- a misspelled name or organization;
- facts belonging to a speaker in the example file;
- unsupported claims about what the speaker will say on stage;
- missing required call-to-action or hashtags.

Save the approved post as:

```text
<speaker-slug>-post.md
```

## Stage 8: Finalize the speaker package

Write a QA record similar to:

```json
{
  "speaker": "Joe Palermo",
  "profile_verified": true,
  "headshot_verified": true,
  "headshot_verification_method": "name-based filename and visual inspection",
  "image_model": "gpt-image-2",
  "image_size": "1024x1536",
  "image_aspect_ratio": "2:3",
  "image_attempts": 1,
  "image_text_verified": true,
  "identity_verified": true,
  "post_facts_verified": true,
  "status": "completed"
}
```

Update the batch manifest only after files have been written and checked.

A speaker is `completed` only when all of these exist and pass validation:

- verified profile JSON;
- verified original-resolution headshot copy;
- saved image prompt;
- approved 2:3 PNG spotlight graphic;
- approved social post;
- QA record.

---

# Batch processing rules

## Independent processing

Treat every speaker as an independent job:

```text
for each supplied name:
  extract verified data
  locate and verify headshot
  freeze card copy
  generate and validate image
  write and validate social post
  save artifacts and QA results
```

One speaker's extraction or image failure must not prevent other speakers from completing.

## Concurrency

- Profile extraction and local headshot searches may run concurrently.
- Image API calls should use bounded concurrency.
- Text-generation calls may run concurrently after each speaker's verified profile is ready.
- Keep filenames and job state isolated to prevent one speaker from overwriting another's files.

## Idempotency and reruns

- Use a stable speaker slug for output paths.
- Do not overwrite an approved output unless the rerun is explicitly requested.
- Save reruns with versioned filenames or attempt numbers.
- Reuse already verified extraction data unless the downloaded site has changed.
- If the source bundle changes, re-extract facts before regenerating assets.

Example attempt names:

```text
joe-palermo-speaker-spotlight-attempt-1.png
joe-palermo-speaker-spotlight-attempt-2.png
joe-palermo-speaker-spotlight.png
```

The unnumbered file should be the final approved version only.

## Error handling

Errors must be specific and actionable:

```json
{
  "speaker": "Example Speaker",
  "stage": "headshot_verification",
  "code": "HEADSHOT_NOT_VERIFIED",
  "message": "A profile record was found, but no image could be reliably matched to the speaker.",
  "retryable": false
}
```

Do not return a generic successful batch status when one or more speaker jobs failed. Return a summary containing counts for completed, review-required, and failed jobs.

---

# Security and operational requirements

- Store `OPENAI_API_KEY` only in server-side environment variables or a secrets manager.
- Never embed the key in frontend JavaScript, HTML, logs, generated Markdown, or downloadable files.
- The browser should call the application's backend, and the backend should call OpenAI.
- Validate uploaded image type and size before forwarding it to the API.
- Sanitize output filenames and do not use raw user input as a filesystem path.
- Apply authentication if the website is not intended for public use.
- Add per-user or per-batch limits to prevent accidental high-volume generation.
- Record API usage and retry counts for cost monitoring.
- Avoid logging full personal-data payloads when normal operational metadata is sufficient.
- Verify that the organization has permission to use each headshot and speaker profile in event promotion.

---

# Final completion checklist

Run this checklist for every speaker:

## Extraction

- [ ] Requested name normalized correctly.
- [ ] Matching profile record found.
- [ ] Display name verified.
- [ ] Role, bio, highlights, industries, badge, and links extracted where available.
- [ ] No neighboring speaker data included.

## Headshot

- [ ] Correct image located.
- [ ] Image-to-speaker mapping verified.
- [ ] Dimensions checked.
- [ ] Image visually inspected.
- [ ] Original copied to the speaker output directory.

## Graphic

- [ ] Verified headshot used as Image 1.
- [ ] Spotlight example used as Image 2.
- [ ] Model is `gpt-image-2`.
- [ ] Endpoint is the Image API edits endpoint.
- [ ] API size is explicitly `1024x1536`.
- [ ] Quality is `high` for the final asset.
- [ ] Saved image is exactly 2:3.
- [ ] Speaker identity is preserved.
- [ ] Speaker name is spelled correctly.
- [ ] All visible facts are verified.
- [ ] Example-speaker content is absent.
- [ ] No clipping, garbling, duplication, watermark, or fake branding.
- [ ] Final design closely matches the reference image.

## Social post

- [ ] Structure and voice match `speaker_spotlight_text_example.md`.
- [ ] Opening hook is relevant.
- [ ] Speaker introduction is factual.
- [ ] Three or four verified bullets included.
- [ ] No invented social handles.
- [ ] Event details and ticket link are exact.
- [ ] Closing paragraph is relevant and supported.
- [ ] Four or five relevant hashtags included.

## Package

- [ ] Profile JSON saved.
- [ ] Headshot saved.
- [ ] Image prompt saved.
- [ ] Approved PNG saved.
- [ ] Post Markdown saved.
- [ ] QA JSON saved.
- [ ] Batch manifest updated.

---

# Official OpenAI references

API behavior can change. Verify implementation details against the current official documentation before deploying changes:

- Image generation guide: https://developers.openai.com/api/docs/guides/image-generation
- Image API edit reference: https://developers.openai.com/api/docs/api-reference/images/createEdit
- GPT Image 2 model page: https://developers.openai.com/api/docs/models/gpt-image-2

This guide was prepared for the API behavior documented on July 12, 2026.
