# AGI Summit Speaker Extraction Guide

Use this guide to quickly retrieve a speaker's profile text and headshot from the downloaded AGI Summit website.

## Downloaded site location

Configure the downloaded copy with `AGI_SUMMIT_SITE_DIR`. For example:

```text
/absolute/path/to/downloaded-agi-summit-site/
```

It contains:

- An `.html` file, which is currently empty (`0 bytes`).
- A corresponding `_files` directory containing the compiled JavaScript bundle and downloaded images.

Do not spend time parsing the empty HTML file. Start with the `_files` directory.

## Quick extraction workflow

### 1. Normalize the speaker's name

Convert the name to lowercase and remove spaces, punctuation, accents, and symbols.

Examples:

| Speaker | Profile key |
|---|---|
| Jun Liu | `junliu` |
| Aengus Lynch | `aenguslynch` |
| Joe Palermo | `joepalermo` |
| Zihan (Gavin) Zheng | `zihangavinzheng` |

The normalized value is usually the property name for the speaker's profile record in the compiled JavaScript.

### 2. Find the text record in the JavaScript bundle

The relevant bundle currently has a name similar to:

```text
AGI Summit 2026 _ AI Conference San Francisco · July 18–19 · Palace of Fine Arts_files/index-Djc_wHl4_KJhG.js
```

The hash in the filename may change in a future download, so locate it dynamically:

```bash
rg --files "$AGI_SUMMIT_SITE_DIR" | rg '/index-.*\.js$'
```

Search that bundle using the normalized profile key. For example, for Jun Liu:

```bash
rg -o -i --text '.{0,120}junliu.{0,2200}' "/path/to/index-bundle.js"
```

The result should resemble this:

```javascript
junliu:{
  linkedin:"https://www.linkedin.com/in/7edu-junliu/",
  roleLine:"Founder & CEO of 7EDU Impact Academy — K-12 education & college counseling",
  highlights:[
    {k:"Founded",t:"7EDU (2014), Leadways School (TK–G8) & 7EDU Global Academy (G9–G12)"},
    {k:"Results",t:"95% of students admitted to Top-30 US universities"},
    {k:"20 years",t:"K-12 counseling & college planning"},
    {k:"Wharton",t:"alumna; NACAC & WACAC member"}
  ],
  industries:["K-12 Education","College Counseling","EdTech"],
  badge:"95% Top-30 Admits"
}
```

### 3. Translate the record into display text

Use these mappings:

| JavaScript field | Displayed as |
|---|---|
| `roleLine` or `bio` | Main description |
| `highlights[].k` | Highlight label |
| `highlights[].t` | Highlight description |
| `stats[].v` | Standalone statistic |
| `industries[]` | Focus topics |
| `badge` | Speaker-card badge |
| `linkedin` | LinkedIn link |
| `x` | X / Twitter link |
| `sub` | Subtitle, when present |
| `tags[]` | Role or affiliation tags, when present |

Retain the original capitalization, punctuation, Unicode characters, and wording. Do not rewrite or summarize the source copy unless asked.

### 4. Find the downloaded headshot

First search the downloaded files for the speaker's name using hyphens, underscores, and partial name variants:

```bash
rg --files "$AGI_SUMMIT_SITE_DIR" | rg -i 'jun[-_ ]?liu'
```

For Jun Liu, this finds:

```text
jun-liu_KJhG.webp
```

Common image extensions are:

```text
.webp
.png
.jpg
.jpeg
```

Downloaded files may have an added suffix such as `_KJhG`. The live image basename `jun-liu.webp`, for example, becomes `jun-liu_KJhG.webp` in the downloaded folder.

### 5. Handle opaque image filenames

Some headshots do not contain the speaker's name. Aengus Lynch's headshot, for example, is:

```text
img-mpvilfjf-e40b3c8bd266_KJhG.webp
```

When the filename is opaque, verify the mapping against the live page:

1. Open `https://agisummit.ai/#` in the in-app browser.
2. If necessary, select **Show all speakers**.
3. Locate the image whose `alt` attribute exactly equals the speaker's full name.
4. Read its `src` or `currentSrc` value.
5. Take the URL basename and locate the corresponding downloaded file, allowing for the inserted `_KJhG` suffix.

Conceptual DOM query:

```javascript
Array.from(document.querySelectorAll('img[alt="Speaker Name"]')).map(img => ({
  src: img.currentSrc || img.src,
  width: img.naturalWidth,
  height: img.naturalHeight
}))
```

If the live site is unavailable, inspect likely images visually and do not claim a name-to-image match unless it can be verified.

### 6. Verify the local image

Check its dimensions:

```bash
sips -g pixelWidth -g pixelHeight "/path/to/headshot.webp"
```

Open or render the local file once to confirm it is a usable headshot and not a logo, thumbnail, or unrelated image.

### 7. Deliver a cleanly named copy

Copy the verified image into this task's `outputs` directory using a predictable filename:

```text
outputs/<speaker-name>-headshot.<extension>
```

Example:

```text
outputs/jun-liu-headshot.webp
```

Do not alter the source image unless the user requests conversion, cropping, resizing, or background changes.

## Standard response format

Return the result in this order:

```markdown
## <Speaker name> headshot

![<Speaker name> headshot](/absolute/path/to/output/headshot.webp)

[Open the original-resolution headshot](/absolute/path/to/output/headshot.webp)

## Text data

AGI Summit · Speaker
<Speaker name>
<Title or subtitle>
<Focus topic 1>
<Focus topic 2>
<Focus topic 3>

<Main description>

Highlights
<Label> · <Description>
<Label> · <Description>

LinkedIn
X / Twitter, if available

Focus · <topic 1> · <topic 2> · <topic 3>
AGISUMMIT.AI
Share card
```

Also include the actual LinkedIn and X URLs as clickable links when present in the source record.

## Fast checklist

1. Normalize the requested name.
2. Search `index-*.js` for the normalized key.
3. Extract `roleLine`/`bio`, highlights, stats, industries, badge, and social links.
4. Search the `_files` directory for a name-based image filename.
5. If the filename is opaque, map the live image `alt` text to its source basename.
6. Verify the local image visually and check its dimensions.
7. Copy it to `outputs/<speaker-name>-headshot.<extension>`.
8. Return the headshot, verbatim profile text, badge, and social links.

## Important cautions

- The downloaded HTML file may be empty even though the required data exists in the JavaScript bundle and image directory.
- Bundle names and downloaded suffixes may change between downloads. Search by patterns rather than assuming the current hashes.
- A speaker's card title and organization may come from the page's speaker-list data, while the richer description and highlights come from the embedded profile record.
- Do not infer that an opaque image belongs to a speaker solely from its position in a directory listing.
- Clearly disclose whether the live site was used only to verify an image mapping.
