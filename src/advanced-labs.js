import { scoreBudget, layerNorm } from './advanced-math.js';
let instance = 0;
const number = new Intl.NumberFormat('en-US');
const fmt = (value, digits = 4) => Math.abs(value) < 0.5 * 10 ** -digits ? '0' : Number(value.toFixed(digits)).toString();
const vector = values => `[${values.map(value => fmt(value)).join(', ')}]`;
const memory = budget => budget.gibibytes >= 1 ? `${fmt(budget.gibibytes, 2)} GiB` : budget.mebibytes >= 1 ? `${fmt(budget.mebibytes, 2)} MiB` : budget.bytes >= 1024 ? `${fmt(budget.bytes / 1024, 2)} KiB` : `${budget.bytes} bytes`;
const topbar = (title, badge) => `<div class="lab-topbar"><span class="eyebrow">${title}</span><span class="pill">${badge}</span></div>`;

/** Counts the score tensor arithmetically; never allocates the displayed matrix. */
export function mountComplexity(element) {
  const id = `complexity-${++instance}`;
  const abort = new AbortController();
  const listen = (target, event, handler) => target.addEventListener(event, handler, { signal: abort.signal });
  let tokens = 1024, heads = 8, bytesPerElement = 2;
  element.innerHTML = `${topbar('EXPERIMENT 06 / THE COST OF CONTEXT', 'An estimate, not an allocation')}
    <div class="lab-body">
      <div class="lab-toolbar complexity-controls">
        <label class="control" for="${id}-tokens">Sequence length n
          <input id="${id}-tokens" type="number" min="1" max="32768" step="1" value="1024" aria-describedby="${id}-error">
        </label>
        <label class="control" for="${id}-heads">Attention heads
          <select id="${id}-heads">${Array.from({ length: 16 }, (_, i) => `<option value="${i + 1}"${i === 7 ? ' selected' : ''}>${i + 1} ${i ? 'heads' : 'head'}</option>`).join('')}</select>
        </label>
        <label class="control" for="${id}-precision">Score storage per element
          <select id="${id}-precision"><option value="2">2 bytes · fp16 / bf16</option><option value="4">4 bytes · fp32</option></select>
        </label>
      </div>
      <div class="complexity-presets" role="group" aria-label="Sequence length presets">${[512, 2048, 8192, 32768].map(n => `<button class="btn secondary" type="button" data-tokens="${n}">${number.format(n)} tokens</button>`).join('')}</div>
      <p id="${id}-error" class="error" role="status"></p>
      <div class="complexity-results" aria-live="polite"></div>
      <div class="complexity-comparison" role="img" aria-label="Doubling sequence length uses four times as many pairwise scores">
        <div><span>n tokens</span><div class="complexity-track"><i class="complexity-bar current"></i></div><strong>1×</strong></div>
        <div><span>2n tokens</span><div class="complexity-track"><i class="complexity-bar doubled"></i></div><strong>4×</strong></div>
      </div>
      <p class="note">One batch item, one dense score tensor, all selected heads. This excludes Q/K/V, model weights, attention output, other layers, optimizer state, gradients and additional buffers. Actual kernels may store scores in a different precision from their inputs. A causal mask does not automatically halve a dense allocation.</p>
      <details><summary>Does long context always require this full matrix in memory?</summary><p class="note">No. This models an implementation that materializes every score. Memory-efficient algorithms such as <a href="https://arxiv.org/abs/2205.14135" target="_blank" rel="noopener noreferrer">FlashAttention</a> use tiled computation to avoid storing the whole score matrix in high-bandwidth memory. They do not turn dense pairwise attention into a linear-time operation. This calculator estimates tensor storage, not GPU purchase requirements or actual runtime.</p></details>
    </div>`;
  const get = selector => element.querySelector(selector);
  function render() {
    const budget = scoreBudget({ tokens, heads, bytesPerElement });
    const doubled = scoreBudget({ tokens: 2 * tokens, heads, bytesPerElement });
    get('.complexity-results').innerHTML = `
      <div class="complexity-metric"><span class="eyebrow">PAIRWISE SCORES</span><strong>${number.format(budget.elements)}</strong><span>${number.format(tokens)}² × ${heads} heads</span></div>
      <div class="complexity-metric"><span class="eyebrow">SCORE TENSOR ONLY</span><strong>${memory(budget)}</strong><span>${number.format(budget.bytes)} bytes</span></div>
      <div class="formula">n² × h × bytes = ${number.format(tokens)}² × ${heads} × ${bytesPerElement}<br>Double to ${number.format(2 * tokens)} tokens → <strong>${memory(doubled)}</strong> (4×)</div>`;
    element.querySelectorAll('[data-tokens]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.tokens) === tokens)));
  }
  function readTokens() {
    const input = get(`#${id}-tokens`), value = Number(input.value);
    const valid = input.value.trim() !== '' && Number.isInteger(value) && value >= 1 && value <= 32768;
    input.setAttribute('aria-invalid', String(!valid));
    get(`#${id}-error`).textContent = valid ? '' : 'Enter a whole sequence length from 1 to 32,768. The last valid estimate is still shown.';
    if (valid) { tokens = value; render(); }
  }
  listen(get(`#${id}-tokens`), 'input', readTokens);
  listen(get(`#${id}-heads`), 'change', () => { heads = Number(get(`#${id}-heads`).value); render(); });
  listen(get(`#${id}-precision`), 'change', () => { bytesPerElement = Number(get(`#${id}-precision`).value); render(); });
  element.querySelectorAll('[data-tokens]').forEach(button => listen(button, 'click', () => { get(`#${id}-tokens`).value = button.dataset.tokens; readTokens(); }));
  render();
  return () => abort.abort();
}

/** Post-normalization over one four-coordinate position, with illustrative scalar affine parameters. */
export function mountNormalization(element) {
  const id = `normalization-${++instance}`;
  const abort = new AbortController();
  const listen = (target, event, handler) => target.addEventListener(event, handler, { signal: abort.signal });
  const defaults = { x: [1, 2, 3, 4], sublayer: [0.5, -0.5, 1, -1] };
  let x = defaults.x.slice(), sublayer = defaults.sublayer.slice(), epsilon = 1e-5, gamma = 1, beta = 0;
  element.innerHTML = `${topbar('EXPERIMENT 05 / ADD, THEN NORMALIZE', 'One position · four features')}
    <div class="lab-body">
      <p class="note">A residual connection adds a sublayer’s result to its input. In the original Transformer, LayerNorm then acts across the feature coordinates of each position. Edit both vectors and trace every step.</p>
      <div class="normalization-inputs">
        ${[['x', 'Original vector x', x], ['sublayer', 'Sublayer result s', sublayer]].map(([key, title, values]) => `<fieldset class="vector-fieldset"><legend>${title}</legend><div class="vector-inputs">${values.map((value, i) => `<label for="${id}-${key}-${i}"><span>Feature ${i + 1}</span><input id="${id}-${key}-${i}" type="number" min="-20" max="20" step="0.1" value="${value}" data-vector="${key}" data-coordinate="${i}" aria-label="${title}, feature ${i + 1}" aria-describedby="${id}-error"></label>`).join('')}</div></fieldset>`).join('')}
      </div>
      <div class="lab-toolbar normalization-controls">
        <label class="control" for="${id}-epsilon">Stability term ε<select id="${id}-epsilon"><option value="0.00001">0.00001</option><option value="0.001">0.001</option><option value="0.1">0.1</option></select></label>
        <label class="control" for="${id}-gamma">Shared gain γ <output id="${id}-gamma-value">1</output><input id="${id}-gamma" type="range" min="-2" max="2" step="0.1" value="1"></label>
        <label class="control" for="${id}-beta">Shared bias β <output id="${id}-beta-value">0</output><input id="${id}-beta" type="range" min="-2" max="2" step="0.1" value="0"></label>
        <button class="btn secondary" type="button" data-action="reset-normalization">Reset vectors</button>
      </div>
      <p id="${id}-error" class="error" role="status"></p>
      <div class="normalization-working" aria-live="polite"></div>
      <div class="normalization-table-wrap" tabindex="0" role="region" aria-label="LayerNorm feature calculations, scroll horizontally if needed"><table class="normalization-table"><thead><tr><th scope="col">Feature</th><th scope="col">x + s</th><th scope="col">Centered</th><th scope="col">Normalized</th><th scope="col">γz + β</th></tr></thead><tbody></tbody></table></div>
      <details><summary>Why epsilon, and why this order?</summary><p class="note">If every coordinate is the same, variance is zero. Positive ε keeps the division defined; normalized coordinates become zero. Because ε is added, the normalized variance is σ²/(σ² + ε), slightly below one when σ² is positive. This is population variance (divide by d, not d − 1).</p><p class="note">This lab demonstrates post-normalization: LayerNorm(x + Sublayer(x)). A pre-normalized block instead computes x + Sublayer(LayerNorm(x)); it generally produces a different result because the sublayer receives a different input. We hold s fixed here, so this is not a model of a pre-norm block. Real LayerNorm usually learns a separate gain and bias for every feature; our sliders deliberately share one value to make their effect easy to inspect. <a href="https://docs.pytorch.org/docs/stable/generated/torch.nn.LayerNorm.html" target="_blank" rel="noopener noreferrer">Read the LayerNorm reference ↗</a></p></details>
      <p class="note">All displayed decimals are rounded; the calculation uses full precision. This is a forward computation, not model training.</p>
    </div>`;
  const get = selector => element.querySelector(selector);
  function render() {
    const residual = x.map((value, i) => value + sublayer[i]);
    const result = layerNorm(residual, { epsilon, gamma, beta });
    const denominator = Math.sqrt(result.variance + epsilon);
    get(`#${id}-gamma-value`).textContent = fmt(gamma, 1);
    get(`#${id}-beta-value`).textContent = fmt(beta, 1);
    get('.normalization-working').innerHTML = `<div class="normalization-steps"><div><span class="eyebrow">01 / ADD</span><div class="formula">r = x + s<br>= ${vector(residual)}</div></div><div><span class="eyebrow">02 / MEASURE</span><div class="formula">μ ≈ ${fmt(result.mean)}<br>σ² ≈ ${fmt(result.variance)}</div></div><div><span class="eyebrow">03 / NORMALIZE</span><div class="formula">z = (r − μ) / √(σ² + ε)<br>denominator ≈ ${fmt(denominator)}</div></div></div><div class="normalization-output"><span class="eyebrow">FINAL OUTPUT · γz + β</span><strong>${vector(result.output)}</strong></div>`;
    get('.normalization-table tbody').innerHTML = residual.map((value, i) => `<tr><th scope="row">${i + 1}</th><td>${fmt(value)}</td><td>${fmt(value - result.mean)}</td><td>${fmt(result.normalized[i])}</td><td>${fmt(result.output[i])}</td></tr>`).join('');
  }
  function readVectors() {
    const inputs = [...element.querySelectorAll('[data-vector]')];
    let invalid = false;
    for (const input of inputs) {
      const value = Number(input.value), valid = input.value.trim() !== '' && Number.isFinite(value) && value >= -20 && value <= 20;
      input.setAttribute('aria-invalid', String(!valid));
      if (!valid) invalid = true;
    }
    get(`#${id}-error`).textContent = invalid ? 'Enter a number between −20 and 20 in every coordinate. The last valid calculation is still shown.' : '';
    if (invalid) return;
    for (const input of inputs) (input.dataset.vector === 'x' ? x : sublayer)[Number(input.dataset.coordinate)] = Number(input.value);
    render();
  }
  element.querySelectorAll('[data-vector]').forEach(input => listen(input, 'input', readVectors));
  listen(get(`#${id}-epsilon`), 'change', () => { epsilon = Number(get(`#${id}-epsilon`).value); render(); });
  listen(get(`#${id}-gamma`), 'input', () => { gamma = Number(get(`#${id}-gamma`).value); render(); });
  listen(get(`#${id}-beta`), 'input', () => { beta = Number(get(`#${id}-beta`).value); render(); });
  listen(get('[data-action="reset-normalization"]'), 'click', () => {
    x = defaults.x.slice(); sublayer = defaults.sublayer.slice();
    for (const input of element.querySelectorAll('[data-vector]')) input.value = (input.dataset.vector === 'x' ? x : sublayer)[Number(input.dataset.coordinate)];
    readVectors();
  });
  render();
  return () => abort.abort();
}
