# Sharing the Speaker Spotlight project

The Speaker Spotlight workflow has two required parts:

1. This GitHub repository, which contains the Marketing Hub application.
2. The merged downloaded AGI Summit site package, which contains the speaker profiles and verified local headshots.

The GitHub repository alone is not enough because the 114 MB downloaded site package is deliberately not committed to Git.

## What to send

Send the recipient:

- The GitHub repository URL, or a ZIP of this repository.
- One ZIP made from `/Users/james/Desktop/u/agi summit website`.

Do not send both downloaded website versions. `agi summit website` is the completed merged package and already contains the unique usable speakers from both snapshots. The separate `agi summit website 2nd version` folder is only a source snapshot and is no longer required to run Speaker Spotlight.

Keep `speaker-content-merge-manifest.json` inside the merged downloaded site ZIP. It records the merged bundle, corrected speaker keys, headshot aliases, source provenance, and the 149-speaker coverage result.

Do not send `.env.local`, `.marketing-hub/`, generated output folders, or an OpenAI API key.

## Recipient setup

After cloning or unzipping the repository, unzip the merged downloaded site folder into the repository root and name it:

```text
agi-summit-site
```

The resulting layout should be:

```text
marketing-project/
├── agi-summit-site/
│   ├── speaker-content-merge-manifest.json
│   ├── AGI Summit 2026 ... .html
│   └── AGI Summit 2026 ... _files/
│       ├── index-speaker-content-merged.js
│       ├── speaker-...-verified.webp
│       └── ...
├── assets for context/
├── src/
├── .env.example
└── package.json
```

Then run:

```bash
npm install
cp .env.example .env.local
npm run db:init
npm run dev
```

`AGI_SUMMIT_SITE_DIR` defaults to `./agi-summit-site`, so no path change is needed with that layout. If the recipient keeps the site package elsewhere, set its absolute path in `.env.local`:

```bash
AGI_SUMMIT_SITE_DIR="/absolute/path/to/agi summit website"
```

For live image generation, the recipient must add their own `OPENAI_API_KEY` or connect a temporary key through Settings. For a network-free check, launch with:

```bash
MARKETING_HUB_DEMO_MODE=true npm run dev
```

## Agent handoff prompt

No special agent is required. If an agent is helping the recipient set up the project, this prompt is sufficient:

> Use the supplied Marketing Hub repository and the merged downloaded AGI Summit site package. Put the site package at `./agi-summit-site` or set `AGI_SUMMIT_SITE_DIR` to its location. Preserve `speaker-content-merge-manifest.json` and `index-speaker-content-merged.js`; do not regenerate or re-merge the speaker data. Install dependencies, initialize the local database, and verify Speaker Spotlight in demo mode.

The merged package was validated through the real Speaker Spotlight workflow in deterministic demo mode on July 16, 2026: all 149 unique speakers completed successfully.
