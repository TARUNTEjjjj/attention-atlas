# Attention Atlas

An interactive field guide to CNNs, RNNs, and the original Transformer, built for learning the mathematics by changing actual inputs.

**Live site:** https://attention-atlas.pages.dev

## Explore

- **CNN:** edit a 5 × 5 image, select four filters, vary stride and zero-padding, and inspect every dot product.
- **RNN:** enter a sequence, step through a scalar tanh recurrence, and inspect the exact chain-rule sensitivity to the initial state.
- **Attention:** edit Q/K/V, compare two heads, toggle the causal mask and scaling, vary temperature, and follow scores → softmax → output. All matrices are illustrative, not trained representations.
- **Transformer:** inspect the original encoder–decoder blocks, residual connections, cross-attention, and eight-coordinate sinusoidal position encodings.
- **Practice:** twelve explained checkpoints, retry, browser-local chapter/answer progress and JSON export.

Read [the learning guide](docs/LEARNING_GUIDE.md) for worked arithmetic and the [validation report](docs/VALIDATION.md) for tested behaviour.

## Run locally

Requires Node.js 22+ for tests/build and Python 3 for the optional development server. There are **no npm dependencies**.

```sh
npm test
npm run build
npm run dev
```

Open http://localhost:8791. Serve the directory over HTTP: ES modules will not work reliably by double-clicking `index.html`.

`npm run build` runs the tests and copies only deployable files into `dist/`. The website performs no API calls; its assets are approximately 110 KB before compression. Learner calculations run on the device. It does not train or host a language model.

## Deploy to Cloudflare Pages

This is a Direct Upload project. Install Cloudflare's official Wrangler CLI, authenticate using `wrangler login`, and run:

```sh
npm run deploy
```

The equivalent deployment is `wrangler pages deploy dist --project-name attention-atlas --branch main` after a successful build. The project was created explicitly on Pages with `wrangler pages project create attention-atlas --production-branch main --force`; existing Pages projects deploy normally without that creation-only flag. GitHub Actions tests every push; publishing is an explicit Wrangler operation, not an automatic Git-triggered deployment. Do not commit access tokens. Cloudflare Direct Upload projects cannot be switched in-place to native Git integration; use a new project or CI-based Wrangler deployment if needed.

## Design and implementation

Buildless ES modules, semantic HTML, responsive CSS, code-drawn SVG diagrams and native controls. No analytics, remote fonts, runtime dependencies, or backend database. The page handles denied/corrupt browser storage and invalid lab inputs without discarding the last valid calculation. A reduced-motion preference disables transitions and smooth scrolling.

`src/math.js` is the pure numerical core. `src/visual-labs.js` renders CNN, attention and architecture experiments; `src/sequence-labs.js` renders recurrence and positions. `src/lessons.js` holds original lesson text and checkpoints. `src/progress.js` validates local progress. `_headers` sets Cloudflare security headers and revalidation caching.

The GitHub repository is private. The deployed site's browser-delivered HTML, CSS and JavaScript are inherently readable by visitors; it contains no private credentials or learner data.

## Research and scope

Grounded in [Attention Is All You Need](https://arxiv.org/abs/1706.03762) (Vaswani et al., 2017), the official [PyTorch Conv2d](https://docs.pytorch.org/docs/stable/generated/torch.nn.Conv2d.html) and [RNN](https://docs.pytorch.org/docs/stable/generated/torch.nn.RNN.html) references, and [Attention is not Explanation](https://aclanthology.org/N19-1357/) (Jain & Wallace, 2019). Explanations and diagrams are original; no paper figure is reproduced. Distinguishes the original post-normalized encoder–decoder from later decoder-only architectures. Attention visualizations are mixing weights, not causal explanations.

After a deploy, `node scripts/check-live.mjs` verifies production file hashes, response statuses, security headers and the custom 404 against the current build.
