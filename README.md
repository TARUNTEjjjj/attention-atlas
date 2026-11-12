# Attention Atlas

An interactive field guide to CNNs, RNNs, and the original Transformer, built for learning the mathematics by changing actual inputs.

**Live site:** https://attention-atlas.pages.dev

## Explore

- **CNN:** edit or clear a 5 × 5 image, select four filters, vary stride and zero-padding, inspect every dot product, and test translation equivariance.
- **RNN:** enter a sequence, step through a scalar tanh recurrence, and inspect the exact chain-rule sensitivity to the initial state. The lesson continues to LSTM gating, gradient clipping and the encoder–decoder bottleneck that motivated attention.
- **Attention:** edit Q/K/V, compare two heads, toggle the causal mask and scaling, vary temperature, and follow scores → softmax → output. All matrices are illustrative, not trained representations.
- **Why √dₖ:** a fixed-seed sample of 2,000 query–key pairs shows the dot-product variance growing with dₖ, and an exact comparison shows softmax saturating without the scale factor.
- **Transformer:** inspect the original encoder–decoder blocks, residual connections, cross-attention, and eight-coordinate sinusoidal position encodings, including a live check, for two of the four frequency pairs, that one fixed rotation per pair maps each position's encoding to the next.
- **LayerNorm:** edit residual vectors, inspect population variance, and explore epsilon, gain and bias.
- **Context cost:** calculate dense attention score memory for up to 32,768 tokens and compare doubling context.
- **From 2017 onward:** the paper's comparison of self-attention, recurrent and convolutional layers, its training recipe and warm-up arithmetic, per-layer parameter counts derived from its equations, and a map of later changes (encoder-only, decoder-only, pre-normalization, rotary positions, FlashAttention), each linked to a primary source.
- **Learning guide:** search six chapters and twenty glossary concepts, with six guided experiments.
- **Practice:** twenty-five explained checkpoints, retry, browser-local progress, JSON export and safe import. Imports preserve already-correct answers.

Read [the learning guide](docs/LEARNING_GUIDE.md) for worked arithmetic and the [validation report](docs/VALIDATION.md) for tested behaviour.

## Run locally

Requires Node.js 22+ for tests/build and Python 3 for the optional development server. There are **no npm dependencies**.

```sh
npm test
npm run build
npm run dev
```

Open http://localhost:8791. Serve the directory over HTTP: ES modules will not work reliably by double-clicking `index.html`.

`npm run build` runs the tests and copies only deployable files into `dist/`. The website performs no API calls; its assets are approximately 190 KB before compression. Learner calculations run on the device. It does not train or host a language model.

## Deploy to Cloudflare Pages

This is a Direct Upload project. Install Cloudflare's official Wrangler CLI, authenticate using `wrangler login`, and run:

```sh
npm run deploy
```

The equivalent deployment is `wrangler pages deploy dist --project-name attention-atlas --branch main` after a successful build. The project was created explicitly on Pages with `wrangler pages project create attention-atlas --production-branch main --force`; existing Pages projects deploy normally without that creation-only flag. GitHub Actions tests every push; publishing is an explicit Wrangler operation, not an automatic Git-triggered deployment. Do not commit access tokens. Cloudflare Direct Upload projects cannot be switched in-place to native Git integration; use a new project or CI-based Wrangler deployment if needed.

## Design and implementation

Buildless ES modules, semantic HTML, responsive CSS, code-drawn SVG diagrams and native controls. No analytics, remote fonts, runtime dependencies, or backend database. The page handles denied/corrupt browser storage and invalid lab inputs without discarding the last valid calculation. A reduced-motion preference disables transitions. Persistent desktop/mobile navigation keeps chapters reachable; offscreen sections defer rendering until needed.

`src/math.js` is the pure numerical core. `src/visual-labs.js` renders CNN, attention and architecture experiments; `src/sequence-labs.js` renders recurrence and positions; `src/advanced-labs.js` renders the √dₖ scaling, LayerNorm and context-cost labs, with their arithmetic in `src/advanced-math.js`. The scaling lab's random sample uses a fixed seed, so every learner sees the same numbers. `src/lessons.js` holds original lesson text and checkpoints. `src/progress.js` validates local progress. `_headers` sets Cloudflare security headers, long-lived immutable caching for release-named assets, and revalidation for HTML. The build emits a deterministic release ID and an asset manifest. New releases change asset paths, avoiding stale JavaScript/CSS. A 350 KB build budget prevents accidental large dependencies.

The GitHub repository is private. The deployed site's browser-delivered HTML, CSS and JavaScript are inherently readable by visitors; it contains no private credentials or learner data.

## Research and scope

Grounded in [Attention Is All You Need](https://arxiv.org/abs/1706.03762) (Vaswani et al., 2017), the official [PyTorch Conv2d](https://docs.pytorch.org/docs/stable/generated/torch.nn.Conv2d.html) and [RNN](https://docs.pytorch.org/docs/stable/generated/torch.nn.RNN.html) references, and [Attention is not Explanation](https://aclanthology.org/N19-1357/) (Jain & Wallace, 2019). Explanations and diagrams are original; no paper figure is reproduced. Distinguishes the original post-normalized encoder–decoder from later decoder-only architectures. Attention visualizations are mixing weights, not causal explanations.

After a deploy, `node scripts/check-live.mjs` verifies production file hashes, response statuses, security headers and the custom 404 against the current build.

## Capacity testing

Read [the measured workload report](docs/CAPACITY.md) and the raw JSON in `docs/load-results/`. The HTTP harness simulates learner session loads; it does not run 10,000 real browsers. Request rate, in-flight requests, response integrity, compression, edge location, errors and latency are recorded separately. Cold refers to an empty learner browser cache, not a purged Cloudflare edge cache. Idle learner concurrency does not require backend session state in this application.

The harness is intentionally limited to this project's production origin. Start with a dry run and small smoke check. Never run loads against an unrelated site by changing the allowlist. The following owner-authorized workload downloads HTML plus the full release bundle for each modeled learner:

```sh
npm run build
node scripts/check-live.mjs
node scripts/load-test.mjs --scenario cold --sessions 10 --rps 25 --concurrency 16 --hold-seconds 0 --output docs/load-results/cold-smoke.json
node scripts/load-test.mjs --scenario cold --sessions 10000 --rps 500 --concurrency 128 --hold-seconds 15 --max-seconds 900 --dry-run
```

Remove `--dry-run` only when intentionally testing the owner-controlled live service. The runner stops on HTTP 403/429 or challenge responses, excess failures, sustained high latency, or the time cap. Build and live deployment must match byte-for-byte. Do not deploy while a test is running. Full bundle session timing includes pacing and sequential asset fetches; it is not a browser load or Web Vitals score.


## Guided revision

The practice sidebar suggests incorrect answers before unanswered questions and
shows both counts. Following a suggestion opens the existing explanation;
only **Try again** clears that answer. The queue updates after imports, resets,
and cross-tab updates. It stays entirely on-device and does not infer mastery.

Custom build destinations cannot overlap source, tests, documentation or Git
metadata, and cannot pass through symbolic links.
