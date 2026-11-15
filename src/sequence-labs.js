import { rnnSequence, positionalEncoding, positionOffsetRotation } from './math.js';

let instance = 0;
const format = (value, digits = 4) => Math.abs(value) < 1e-6 ? (0).toFixed(digits) : value.toFixed(digits);
const svgNS = 'http://www.w3.org/2000/svg';
const makeSVG = (tag, attributes = {}) => {
  const element = document.createElementNS(svgNS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
};

/** Mount a deliberately small scalar RNN. All weights are illustrative, not trained. */
export function mountRNN(element) {
  const id = `rnn-${++instance}`;
  let inputs = [1, 0.5, -1, 0.8];
  let wx = 0.8;
  let wh = 0.7;
  let revealed = 1;
  let selected = 0;
  const abort = new AbortController();
  const listen = (target, event, handler) => target.addEventListener(event, handler, { signal: abort.signal });

  element.innerHTML = `
    <div class="lab-toolbar sequence-controls">
      <label class="control sequence-input" for="${id}-inputs">Input sequence
        <input id="${id}-inputs" type="text" inputmode="decimal" value="1, 0.5, -1, 0.8" spellcheck="false" aria-describedby="${id}-hint ${id}-error">
        <small id="${id}-hint">1–10 numbers, each between −5 and 5, separated by commas.</small>
      </label>
      <label class="control" for="${id}-wx">Input weight wₓ <output class="range-value" id="${id}-wx-value">0.8</output>
        <input id="${id}-wx" type="range" min="-2" max="2" step="0.1" value="0.8">
      </label>
      <label class="control" for="${id}-wh">Memory weight wₕ <output class="range-value" id="${id}-wh-value">0.7</output>
        <input id="${id}-wh" type="range" min="-2" max="2" step="0.1" value="0.7">
      </label>
    </div>
    <p id="${id}-error" class="error sequence-error" role="status"></p>
    <div class="sequence-strip" role="group" aria-label="Unrolled RNN states"></div>
    <div class="lab-toolbar sequence-actions">
      <button class="btn primary" type="button" data-action="step">Next step →</button>
      <button class="btn secondary" type="button" data-action="all">Reveal all steps</button>
      <button class="btn secondary" type="button" data-action="reset">Reset sequence</button>
      <span class="sequence-counter note"></span>
    </div>
    <div class="rnn-working" aria-live="polite" aria-atomic="true"></div>
    <details class="sequence-details"><summary>Why can an RNN forget earlier inputs?</summary>
      <p>The derivative through one step is w<sub>h</sub>(1 − h<sub>t</sub>²). Across steps, these factors multiply. Small factors shrink the signal sent backward during training; large factors can amplify it. Large input magnitudes can saturate tanh, making 1 − h² nearly zero.</p>
      <p>With the default inputs, try w<sub>h</sub> = 1.2, then 2.0. The four-step sensitivity falls from about 0.172 to about 0.018. The first state, h<sub>1</sub> = tanh(0.8), is the same in both runs, but the larger weight pushes h<sub>2</sub> to h<sub>4</sub> toward ±1, where 1 − h² is small. A larger memory weight does not guarantee a larger final gradient. Setting w<sub>h</sub> = 0 removes the dependence on h<sub>0</sub> entirely. This scalar derivative is ∂h<sub>t</sub>/∂h<sub>0</sub>, not a complete loss gradient. Vector RNNs use products of Jacobian matrices.</p>
    </details>
    <p class="note sequence-footnote">Toy RNN · one hidden value · shared weights at every step · bias = 0 · h₀ = 0. These values are chosen for learning, not fitted to data.</p>`;

  const get = (selector) => element.querySelector(selector);
  const sequenceInput = get(`#${id}-inputs`);
  const error = get(`#${id}-error`);
  const strip = get('.sequence-strip');
  const working = get('.rnn-working');

  function render() {
    const states = rnnSequence(inputs, { wx, wh, bias: 0, h0: 0 });
    strip.replaceChildren();
    const initial = document.createElement('div');
    initial.className = 'state-node initial-state';
    initial.innerHTML = '<span class="eyebrow">Initial</span><strong>h₀ = 0</strong><small>Start with no memory</small>';
    strip.append(initial);
    states.forEach((state, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `state-node${selected === index && index < revealed ? ' is-active' : ''}`;
      button.disabled = index >= revealed;
      button.dataset.index = String(index);
      button.setAttribute('aria-pressed', String(selected === index && index < revealed));
      button.setAttribute('aria-label', `Inspect step ${index + 1}, input ${state.input}${index < revealed ? `, hidden state ${format(state.hidden)}` : ', not revealed yet'}`);
      button.innerHTML = `<span class="eyebrow">Step ${index + 1} · <span class="math-case">x = ${state.input}</span></span><strong>h${index + 1} = ${index < revealed ? format(state.hidden) : '?'}</strong><small>${index < revealed ? 'Inspect calculation' : 'Waiting for previous state'}</small>`;
      strip.append(button);
    });
    get('[data-action="step"]').disabled = revealed >= inputs.length;
    get('[data-action="all"]').disabled = revealed >= inputs.length;
    get('.sequence-counter').textContent = `${revealed} / ${inputs.length} steps revealed`;
    if (!revealed) {
      working.innerHTML = '<div class="formula"><span class="eyebrow">Ready for the first input</span><p>h₀ = 0 → h₁ = tanh(wₓ × x₁ + wₕ × h₀)</p></div><p class="note">Select Next step to carry the first input into memory.</p>';
      return;
    }
    const state = states[selected];
    const products = states.slice(0, selected + 1).map((entry) => format(entry.localDerivative, 3)).join(' × ');
    const gradient = Math.abs(state.gradientToInitial);
    const explanation = gradient < 0.1
      ? 'A small change to the initial state barely affects this state. The sensitivity has shrunk.'
      : gradient > 1
        ? 'A small change to the initial state is amplified at this step.'
        : gradient === 1
          ? 'The derivative magnitude is one: an infinitesimal change to the initial state keeps its size at this step.'
          : 'Some sensitivity to the initial state remains, but the derivative magnitude is below one.';
    working.innerHTML = `
      <div class="formula rnn-equation"><span class="eyebrow">Step ${selected + 1} · forward calculation</span>
        <p>h<sub>${selected + 1}</sub> ≈ tanh(${wx.toFixed(1)} × ${state.input} + ${wh.toFixed(1)} × ${format(state.previous)})</p>
        <p>≈ tanh(${format(state.preactivation)}) ≈ <strong>${format(state.hidden)}</strong></p>
      </div>
      <div class="sequence-sensitivity">
        <div><span class="eyebrow">Local derivative</span><strong>${format(state.localDerivative)}</strong><small>w<sub>h</sub>(1 − h<sub>${selected + 1}</sub>²)</small></div>
        <div><span class="eyebrow math-case">∂h<sub>${selected + 1}</sub> / ∂h₀</span><strong>${state.gradientToInitial.toExponential(3)}</strong><small>Product through ${selected + 1} step${selected ? 's' : ''}</small></div>
        <p>${explanation}</p>
      </div>
      <details class="sequence-details"><summary>Follow the chain rule</summary><p class="sequence-product">${products} ≈ ${state.gradientToInitial.toExponential(3)}</p><p>Displayed factors are rounded; calculations use full precision. Each factor measures how one hidden state responds to the previous one. The sign tells you the direction of that response; the magnitude tells you its size.</p></details>`;
  }

  listen(sequenceInput, 'input', () => {
    const pieces = sequenceInput.value.split(',').map((part) => part.trim().replaceAll('−', '-'));
    const parsed = pieces.map(Number);
    if (pieces.length > 10 || pieces.some((part) => part === '') || parsed.some((value) => !Number.isFinite(value) || value < -5 || value > 5)) {
      error.textContent = 'Use 1–10 comma-separated numbers between −5 and 5, for example 1, 0.5, −1. The last valid sequence is still shown.';
      sequenceInput.setAttribute('aria-invalid', 'true');
      return;
    }
    error.textContent = '';
    sequenceInput.removeAttribute('aria-invalid');
    inputs = parsed;
    revealed = 1;
    selected = 0;
    render();
  });
  listen(get(`#${id}-wx`), 'input', (event) => {
    wx = Number(event.target.value);
    get(`#${id}-wx-value`).textContent = wx.toFixed(1);
    render();
  });
  listen(get(`#${id}-wh`), 'input', (event) => {
    wh = Number(event.target.value);
    get(`#${id}-wh-value`).textContent = wh.toFixed(1);
    render();
  });
  listen(get('[data-action="step"]'), 'click', () => {
    revealed = Math.min(revealed + 1, inputs.length);
    selected = revealed - 1;
    render();
  });
  listen(get('[data-action="all"]'), 'click', () => {
    revealed = inputs.length;
    selected = inputs.length - 1;
    render();
  });
  listen(get('[data-action="reset"]'), 'click', () => {
    revealed = 0;
    selected = 0;
    render();
  });
  listen(strip, 'click', (event) => {
    const button = event.target.closest('button[data-index]');
    if (!button || button.disabled) return;
    selected = Number(button.dataset.index);
    render();
    strip.querySelector(`button[data-index="${selected}"]`).focus({ preventScroll: true });
  });
  render();
  return () => abort.abort();
}

/** Eight-dimensional sinusoidal positions, using the original paper's convention. */
export function mountPosition(element) {
  const id = `position-${++instance}`;
  const abort = new AbortController();
  element.innerHTML = `
    <div class="lab-toolbar">
      <label class="control position-control" for="${id}-position">Token position <output class="range-value" id="${id}-value">4</output>
        <input id="${id}-position" type="range" min="0" max="100" step="1" value="4">
      </label>
      <span class="pill">8 dimensions · sinusoidal encoding</span>
    </div>
    <div class="position-legend"><span><i class="position-dot current-dot"></i>Selected position</span><span><i class="position-dot next-dot"></i>Next position</span></div>
    <div class="position-layout"><div class="position-chart"></div><div class="position-table-wrap"><table class="position-table"><caption>Encoding values, rounded to 4 decimals</caption><thead><tr><th scope="col">Dimension</th><th scope="col" data-current>p = 4</th><th scope="col" data-next>p = 5</th></tr></thead><tbody></tbody></table></div></div>
    <div class="formula position-formula">PE(p, 2i) = sin(p / 10000<sup>2i/d</sup>)<br>PE(p, 2i + 1) = cos(p / 10000<sup>2i/d</sup>)</div>
    <p class="position-example note" aria-live="polite"></p>
    <div class="position-offset" aria-live="polite"></div>
    <details class="sequence-details"><summary>How does this enter the Transformer?</summary><p>In the original paper, scale the token embedding by √d, then add this vector element by element before the first layer: input = √d × token embedding + positional encoding. Both vectors must have the same dimension d. The table uses d = 8 to keep the calculation visible; the original base model used d = 512.</p><p>Each sine/cosine pair uses a different wavelength. Adjacent positions can be similar without being identical. Position zero is not an all-zero vector: its sine coordinates are 0 and its cosine coordinates are 1. Positional encodings describe order, not a token's meaning.</p></details>
    <details class="sequence-details"><summary>Why sinusoids? Rotation by a fixed offset</summary><p>Pair i turns at frequency ω = 1 / 10000<sup>2i/d</sup>. With d = 8 the four pairs have wavelengths 2π, 20π, 200π and 2000π positions (about 6.3, 63, 628 and 6,283). For d = 512 the paper describes wavelengths in a geometric progression from 2π towards 10000 · 2π.</p><p>The sine and cosine angle-addition rules give PE(p + k) = R(kω) · PE(p) for every pair, where R is a 2 × 2 rotation that depends only on the offset k and the pair's frequency ω. The authors chose sinusoids because they hypothesised that this would make relative positions easy to learn. Learned position embeddings gave nearly identical results (Table 3, row E); the paper kept sinusoids because they may let the model extrapolate to sequences longer than those seen in training. The panel above checks the rotation for k = 1.</p><p>Later models build on the same rotation. Rotary position embedding (Su et al.) uses the same frequencies, but rotates each query and key by its own position instead of adding a vector. The dot product of a query at m and a key at n then depends on their positions only through the offset n − m. <a href="https://arxiv.org/abs/2104.09864" target="_blank" rel="noopener noreferrer">Read the RoFormer paper ↗</a></p></details>`;
  const chart = element.querySelector('.position-chart');
  const body = element.querySelector('tbody');
  const slider = element.querySelector(`#${id}-position`);
  function render() {
    const position = Number(slider.value);
    const current = positionalEncoding(position, 8);
    const next = positionalEncoding(position + 1, 8);
    element.querySelector(`#${id}-value`).textContent = String(position);
    element.querySelector('[data-current]').textContent = `p = ${position}`;
    element.querySelector('[data-next]').textContent = `p = ${position + 1}`;
    const svg = makeSVG('svg', { viewBox: '0 0 440 308', role: 'img', 'aria-label': `Comparison of eight sinusoidal encoding dimensions for positions ${position} and ${position + 1}. Numeric values are in the adjacent table.` });
    const title = makeSVG('title');
    title.textContent = 'Position changes a vector, not just a single number';
    svg.append(title);
    [-1, 0, 1].forEach((tick) => {
      const x = 90 + (tick + 1) * 160;
      svg.append(makeSVG('line', { x1: x, x2: x, y1: 28, y2: 281, class: tick === 0 ? 'position-zero' : 'position-guide' }));
      const label = makeSVG('text', { x, y: 18, 'text-anchor': 'middle', class: 'position-axis-label' });
      label.textContent = String(tick);
      svg.append(label);
    });
    body.replaceChildren();
    current.forEach((value, dim) => {
      const y = 40 + dim * 33;
      const label = makeSVG('text', { x: 8, y: y + 4, class: 'position-axis-label' });
      label.textContent = `d${dim} ${dim % 2 ? 'cos' : 'sin'}`;
      svg.append(label);
      svg.append(makeSVG('line', { x1: 90, x2: 410, y1: y, y2: y, class: 'position-row' }));
      svg.append(makeSVG('line', { x1: 90 + (value + 1) * 160, x2: 90 + (next[dim] + 1) * 160, y1: y, y2: y, class: 'position-change' }));
      svg.append(makeSVG('circle', { cx: 90 + (next[dim] + 1) * 160, cy: y, r: 6, class: 'position-next' }));
      svg.append(makeSVG('circle', { cx: 90 + (value + 1) * 160, cy: y, r: 4, class: 'position-current' }));
      const row = document.createElement('tr');
      const heading = document.createElement('th');
      heading.scope = 'row';
      heading.textContent = `${dim} · ${dim % 2 ? 'cos' : 'sin'}`;
      row.append(heading);
      for (const coordinate of [value, next[dim]]) {
        const cell = document.createElement('td');
        cell.textContent = format(coordinate);
        row.append(cell);
      }
      body.append(row);
    });
    chart.replaceChildren(svg);
    element.querySelector('.position-example').textContent = `At position ${position}, dimension 2 is sin(${position} / 10) ≈ ${format(current[2])}. Dimensions 2 and 3 share denominator 10 because 10000^(2/8) = 10. The same pair at position ${position + 1} uses (${position + 1}) / 10.`;
    const pair = (values) => `[${values.map((value) => format(value)).join(', ')}]`;
    element.querySelector('.position-offset').innerHTML = `<span class="eyebrow">Offset check · rotate instead of recomputing</span><div class="formula">${[0, 1].map((index) => {
      const r = positionOffsetRotation(position, 1, index, 8);
      return `pair ${index} · ω = ${Number(r.frequency.toPrecision(6))} · R = [[${format(r.matrix[0][0])}, ${format(r.matrix[0][1])}], [${format(r.matrix[1][0])}, ${format(r.matrix[1][1])}]]<br>at p = ${position}: ${pair(r.from)}<br>R × that pair: ${pair(r.rotated)}<br>at p = ${position + 1}: ${pair(r.target)}`;
    }).join('<br><br>')}</div><p class="note">Move the slider: the vectors change, but each rotation R stays the same. R depends only on the offset (1 step) and the pair's frequency, not on the position.</p>`;
  }
  slider.addEventListener('input', render, { signal: abort.signal });
  render();
  return () => abort.abort();
}
