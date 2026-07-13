# Manual live OpenAI verification

Automated validation uses deterministic mocks and makes no billable request. Perform this checklist only with a temporary API key whose owner approves API charges.

1. Install, initialize, and start on loopback:

   ```bash
   npm install
   npm run db:init
   npm run dev
   ```

   Open `http://127.0.0.1:3000` and confirm the server is not listening on `0.0.0.0`.

2. Open Settings, enter the temporary key, read the billing notice, and click **Connect and test**.
3. In browser developer tools confirm:
   - `localStorage` and `sessionStorage` have no key;
   - IndexedDB has no Marketing Hub key database;
   - page HTML and React payloads contain no key;
   - the connection response contains only state/source/suffix/message;
   - the cookie value is opaque and does not contain the key.
4. Inspect `.marketing-hub/marketing-hub.sqlite` with SQLite and search files under `.marketing-hub/`; confirm the raw key is absent.
5. Add the fictional example context from `examples/context/`.
6. Run a small live lead search with five requested results and a narrow Bay Area objective.
7. Open every result’s source section. Confirm links are clickable and claims are understandable.
8. If any provider output suggests an email without an exact supporting URL, confirm Marketing Hub nulls the address and adds a warning. A contact page may remain.
9. Select one compliant lead and generate an outreach draft. Confirm no Send control exists.
10. Create X, LinkedIn, and Instagram posts from selected context. Check that copy differs meaningfully and missing facts are not invented.
11. Generate one campaign image. Confirm the base is text-free and exact visible text is the application overlay. If organization verification/model access is required, confirm the sanitized UI error and retry state while saved posts remain intact.
12. Disconnect the key in Settings. Confirm the cookie is removed and the connection endpoint reports disconnected (unless an environment key exists).
13. Stop the Node process. Restart and confirm context, research, leads, drafts, posts, and image assets reopen, while the temporary key does not.

Record model names, request outcomes, and any account-specific limitations. Do not claim live validation unless this checklist was actually executed.

## Speaker Spotlight live check

1. Confirm `AGI_SUMMIT_SITE_DIR` points to the downloaded AGI Summit site and the project context directory contains the creation guide, extraction guide, caption example, and visual reference.
2. Submit one easily name-matched speaker first. Confirm the UI returns a verified profile, copied original headshot, exact 1024×1536 first-output PNG, and caption after one image request.
3. Inspect `MARKETING_HUB_DATA_DIR/speaker_spotlights/<batch-id>/manifest.json` and the speaker directory. Confirm request IDs and manual retry counts are present without any API key, and that no generated-card vision-QA request occurred.
4. Submit two speakers together and deliberately include one unknown name. Confirm the valid speaker completes and the unknown speaker reports an isolated extraction failure.
5. Inspect the poster for identity, exact spelling, verified facts, three icon-led highlight rows, the white-left/near-black-right diagonal split, correct event footer, no Holly Zheng or example-wardrobe remnants, and no clipping. Confirm the caption contains only source-backed facts and exact configured campaign values.
