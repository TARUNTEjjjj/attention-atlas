# Release validation — 1.2.0

Tested 5 November 2026 (India Standard Time). Local verification only: 1.2.0 has not been deployed, so the live site serves 1.1.0 until `npm run deploy` runs, and GitHub Actions has not yet run the upgraded workflow.

- **119 automated checks pass** on Node.js 26.13.0, 24.22.2 and 22.23.4: 39 core numerical tests, 19 advanced numerical tests, 16 progress/import tests, 11 learning search tests, 9 content integration tests, 3 build/cache tests and 22 load-harness tests. `npm test`, `npm run build` and `node --check` ran twice before and twice after the tooling upgrade; every run passed and produced the same release.
- **Content review:** lessons, lab text, glossary, checkpoints and the learning guide were checked against primary sources: the arXiv v7 LaTeX source of the Transformer paper, PyTorch 2.15 documentation, and the arXiv and ACL Anthology pages of every cited paper. An independent fact-check then recomputed every new number and checked every new attribution. It found one over-claim (pre-normalization had no linked source) and four imprecise statements (attention-layer cost without projections, the paper's reason for keeping sinusoids, an ambiguous quiz distractor, and saturation described without its dₖ condition). All were corrected, with regression tests for the first two.
- **Corrections to 1.1 content:** the RNN lab suggested w_h = 0 and 1.5 to show that a larger weight need not raise the final sensitivity, but that pair raises it from 0 to about 0.109; it now uses 1.2 (about 0.172) and 2.0 (about 0.018). Uppercase labels displayed ∂h/∂h₀ as ∂H/∂H₀, x as X and γz + β as ΓZ + Β; mathematical symbols now keep their case.
- **Browser:** the built release was tested at 1280 × 800 and at 375 × 812 with a mobile user agent, twice before and twice after the upgrade, and the source at 320 × 700. Each pass ran 58 scripted checks covering every lab, the new √dₖ lab at dₖ = 1, 64 and 512, the position offset check, the CNN clear-and-shift experiment, search, glossary, 25 checkpoints, symbol case and page-wide overflow. No run failed a check, and no console messages were logged.
- Deterministic release **58e24e020909559b**, total static build **189,812 bytes** before compression, within the 350,000-byte budget. The scaling lab's random sample uses a fixed seed, so its numbers are reproducible.
- **Tooling:** actions/checkout v4 → v7 and actions/setup-node v4 → v7 (neither breaking change applies: no `pull_request_target`, no `packageManager` field, no npm publishing); Node 26 joins the CI matrix; checkout no longer persists credentials; superseded runs are cancelled; jobs time out after 10 minutes; one Node version failing no longer cancels the others. `actionlint` 1.7.12 reports no problems. `npm run dev` now binds to 127.0.0.1 only.

---

# Release validation — 1.1.0

Tested 5 November 2026 (India Standard Time).

- **103 automated checks pass:** 33 core numerical tests, 14 advanced numerical tests, 16 progress/import tests, 9 learning search tests, 6 content integration tests, 3 build/cache tests, and 22 load-harness tests. The runner's executable tests use mocked HTTPS and produce no remote traffic.
- Browser-tested new search (including Enter-to-result), glossary/navigation, LayerNorm's constant-input and invalid-input cases, 32,768-token storage calculations, and the advanced checkpoints. Verified zero-variance normalization stays finite and the 16-head fp32 score estimate is 64 GiB.
- Browser-tested progress import with a real downloaded export. An older wrong answer cannot replace a current correct answer; an import cancels an armed reset. Existing first-release progress remains compatible.
- Verified responsive widths of 320 and 390 pixels and desktop; no page-wide horizontal overflow. The mobile chapter bar and feature table scroll within their own regions. No runtime warning/error logs were observed in the exercised flows.
- Live deployment has 17 served files, including 14 immutable assets. Every file matches the build hash, HTML is revalidated, security headers are present, and missing routes return the custom 404.
- Deterministic release **9369f6aceda5b33c**, total static build **150,062 bytes** before compression. A 350,000-byte build budget rejects oversized releases.
- See [the measured capacity report](CAPACITY.md) and its raw JSON for live load outcomes and their precise limits. No claim is made that an HTTP session model represents 10,000 simultaneous real browsers.

The source repository remains private; the public browser assets contain no credentials. All experiments run on the learner's device. No backend database, paid infrastructure, tracking analytics or API dependency was added.

---

# Release validation — 1.0.0

Tested 5 November 2026 (India Standard Time).

## Automated checks

`npm run build` passes all **52 tests** and packages the static website:

- 33 numerical checks: independent hand calculations, cross-correlation versus flipped convolution, stride/padding, softmax stability, causal isolation, matrix shapes, convex combinations, finite-difference recurrent gradients, positional frequencies, non-finite input/overflow handling.
- 13 progress checks: JSON round trips, corrupt/truncated data, denied/quota-exceeded storage, unknown chapters/questions, invalid answer indices, malicious keys and independent normalized copies.
- 6 content checks: matching chapters/mounts/navigation, actual asset paths, question IDs/answer bounds, independently calculated numerical answers, HTTPS references and safe authored HTML.
- `node --check` passes for all interactive entry modules.
- GitHub Actions runs the same build with Node 22 and 24 on pushes and pull requests. The Actions run is the authoritative record of remote CI status.

## Browser checks

Performed in the actual in-app browser, against localhost and the public Cloudflare URL. Responsive layout checked at 320, 390 and 768 pixel viewport overrides and the default desktop viewport. No document-wide horizontal overflow at those widths. The RNN sequence intentionally scrolls within its panel. This is responsive browser testing, not a claim of testing physical phones or every browser engine.

- CNN identity filter + stride 2 changes output to 2 × 2; padding 1 changes it to 3 × 3; toggling the top-left pixel changes the inspected output from 0 to 1.
- RNN reveal-all calculates the four default states; malformed CSV retains the previous valid state with explanatory feedback. Six zero inputs with recurrent weight 1 produce unit initial-state sensitivity and correct wording.
- Causal attention for the first token yields [1,0,0,0] weights and output [1,0]. Switching to the second head yields [0.5,0]. Later-query mixing and future exclusion verified.
- Out-of-range Q entries show an error and retain the last valid calculation; Reset vectors clears the error and restores the example.
- Transformer blocks expose the appropriate explanations; only repeated sublayers are inside repeat groups. Position 0 alternates 0/1; positions 100 and 101 render correctly.
- Wrong quiz answer gives an explanation; retry and correct answer update progress; answers and chapter completion survive reload. Keyboard Enter activates question navigation. Question 12 is reachable.
- JSON progress export downloaded and its contents were checked. Two-step reset clears only this site's chapter/quiz progress.
- Fixed a mobile control overlap and verified control rectangles no longer overlap at 390 px.
- No browser error/warning logs in the exercised local or live flows. Browser testing used the same asset bytes verified below.

## Hosting verification

Public URL: https://attention-atlas.pages.dev/

`node scripts/check-live.mjs` verified:

- All 11 served assets return HTTP 200 and their SHA-256 hashes match `dist/`.
- `X-Content-Type-Options: nosniff` and the restrictive script CSP are present.
- A nonexistent path returns HTTP 404 with the custom error page.
- Total build size including `_headers`: 103,259 bytes before compression. No runtime dependencies, model downloads, remote fonts or third-party API calls.

Deployment uses the existing Cloudflare Pages project via Wrangler Direct Upload. No Workers service or paid infrastructure is required. The first project-creation command attempted newer Workers delegation and failed without deploying; the project was then successfully created explicitly on Pages. The generated Workers configuration/dependency changes were removed. Subsequent deployments target Pages normally.

## Scope

The site teaches mechanisms with fixed illustrative numbers; it does not train models, authenticate learners or sync progress between devices. It does not guarantee proficiency from completing the exercises. No load-test or universal browser compatibility claim is made. Source repository visibility is private; browser-delivered assets are necessarily public. No credentials are shipped.
