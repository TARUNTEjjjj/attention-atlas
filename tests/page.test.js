import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {FakeDocument, FakeEvent, shownText} from './fake-dom.js';
import {lessons, quiz, sources} from '../src/lessons.js';
import {STORAGE_KEY, CHAPTERS} from '../src/progress.js';
import {learningContent} from '../src/learning-tools.js';
import {dotProductSpread} from '../src/advanced-math.js';

// The real index.html, wired by the real app.js. If any module stops linking (a renamed export, say), this import
// throws and every test in the file fails, as the whole page would in a browser.
const document = new FakeDocument(await readFile(new URL('../index.html', import.meta.url), 'utf8'));
const saved = new Map(), storageListeners = [];
let failWrites = false; // set while a test needs every write to fail, as a full or locked store does
const localStorage = {getItem: key => saved.get(key) ?? null, setItem: (key, value) => { if (failWrites) throw new Error('QuotaExceededError'); saved.set(key, String(value)); }, removeItem: key => saved.delete(key)};
Object.assign(globalThis, {document, window: {localStorage, addEventListener: (type, listener) => { if (type === 'storage') storageListeners.push(listener); }, removeEventListener() {}}});
await import('../src/app.js');
// Another tab saves progress; the browser then tells this tab with a storage event.
function otherTab(progress) {
  saved.set(STORAGE_KEY, JSON.stringify(progress));
  for (const listener of storageListeners) listener({key: STORAGE_KEY, newValue: saved.get(STORAGE_KEY), storageArea: localStorage});
}
function failingWrites(action) { failWrites = true; try { action(); } finally { failWrites = false; } }

const $ = selector => document.querySelector(selector);
const fire = (element, type, init = {}) => element.dispatchEvent(new FakeEvent(type, {bubbles: true, ...init}));
const type = (input, value) => { input.value = value; fire(input, 'input'); };
const choose = (select, value) => { select.value = value; assert.equal(select.value, String(value), `no option ${value}`); fire(select, 'change'); };
const text = element => element.textContent.replace(/\s+/g, ' ').trim();
// Elements are compared by identity and named by a short label, never handed to assert: it prints both sides of a
// failed comparison in full.
const label = element => element ? `<${element.localName}${element.id ? ` id="${element.id}"` : ''}> “${text(element).slice(0, 40)}”` : String(element);
function focused(expected, message) {
  const actual = document.activeElement;
  if (!expected || actual !== expected) assert.fail(`${message}: focus is on ${label(actual)}, not on ${label(expected)}`);
}
// Text split at <br>, which textContent drops.
function lines(element) {
  const result = [''];
  (function walk(node) {
    for (const child of node.childNodes) {
      if (child.localName === 'br') result.push('');
      else if (child.localName) walk(child);
      else result[result.length - 1] += child.textContent;
    }
  })(element);
  return result.map(line => line.replace(/\s+/g, ' ').trim());
}
const superscripts = '⁻⁰¹²³⁴⁵⁶⁷⁸⁹';
// Every number in a displayed string, in order. "1.48 × 10⁻¹⁰" reads as 1.48e-10 and "−∞" as -Infinity.
// Displayed numbers are rounded, so each must be within half a unit of its last shown digit of the exact value.
function close(shown, expected, message) {
  const tokens = shown.replace(/ × 10([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_, power) => `e${[...power].map(c => '-0123456789'[superscripts.indexOf(c)]).join('')}`)
    .match(/−∞|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g) ?? [];
  assert.equal(tokens.length, expected.length, `${message}: ${shown}`);
  tokens.forEach((token, i) => {
    const value = token === '−∞' ? -Infinity : Number(token), [mantissa, exponent = 0] = token.split('e');
    const tolerance = 0.5 * 10 ** (Number(exponent) - (/\.(\d+)/.exec(mantissa)?.[1].length ?? 0)) + Math.abs(expected[i]) * 1e-9 + 1e-15;
    assert.ok(value === expected[i] || Math.abs(value - expected[i]) <= tolerance, `${message}: shown ${shown}, expected ${expected.join(', ')}`);
  });
}

test('page: app.js mounts every lab, lesson and source into index.html', () => {
  for (const id of ['learning-tools', 'cnn-lab', 'rnn-lab', 'attention-lab', 'scaling-lab', 'transformer-map', 'position-lab', 'normalization-lab', 'complexity-lab', 'quiz', 'source-list']) {
    assert.ok(document.getElementById(id).children.length > 0, `#${id} was left empty`);
  }
  for (const lesson of lessons) assert.equal(text($(`[data-lesson="${lesson.id}"] summary`)), `The maths, explained · ${lesson.title}`);
  // The RNN and position labs render without a frame; app.js adds a topbar and moves their content into .lab-body.
  for (const id of ['rnn-lab', 'position-lab']) {
    assert.deepEqual(document.getElementById(id).children.map(child => child.className), ['lab-topbar', 'lab-body']);
  }
  assert.equal(document.querySelectorAll('#source-list a.source').length, sources.length);
});

test('DOM stand-in: a failed assertion that holds an element fails at once, printing its tag and attributes, not the page', () => {
  // assert prints both values of a failed comparison with every enumerable property, to any depth. When an element's
  // parent, children and document were among them, one element printed as the whole page, once for each node it
  // reached: with the retry button's id changed, this file ran out of memory instead of reporting a failure.
  // So first count what an element's enumerable properties lead to, without printing anything.
  const question = $('#quiz-question'), reached = new Set([question]);
  for (const value of reached) {
    if (reached.size > 50 || !value || typeof value !== 'object') continue;
    for (const next of value instanceof Map ? [...value.keys(), ...value.values()] : Object.values(value)) reached.add(next);
  }
  assert.ok(reached.size <= 50, 'an element\'s enumerable properties lead into the rest of the page');
  // Then a real failure is short. Two elements that look the same are still different elements to deepEqual.
  const short = error => error instanceof assert.AssertionError && error.message.length < 2000;
  assert.throws(() => assert.equal(question, $('#quiz'), 'two different elements'), short);
  const [first, second] = document.querySelectorAll('.mini-cnn i');
  assert.deepEqual([first.localName, [...first.attributeMap], second.localName, [...second.attributeMap]], ['i', [], 'i', []]);
  assert.throws(() => assert.deepEqual([first], [second]), short);
});

test('App updates: the page allows a reload for a new release only while nothing in this tab would be lost', () => {
  // resources/app-updates.mjs asks window.appUpdateCanReload() before it reloads the page for a newly deployed release.
  // This test runs before any other presses a key in a lab, which keeps the answer false until the next page load.
  const canReload = () => window.appUpdateCanReload(), cnn = $('[data-complete="cnn"]'), reset = $('#reset-progress');
  assert.equal(canReload(), true, 'a page just loaded, with working storage');
  // This test opens the privacy panel (a failed save does) and closes it again, so check here that it started closed.
  assert.equal($('.privacy-details').open, false, 'with working storage the privacy panel stays closed');
  assert.doesNotMatch(shownText($('.chapter-rail')), /not saved/i);
  failingWrites(() => cnn.click());
  assert.equal(canReload(), false, 'this tab holds a chapter mark that is not saved');
  cnn.click(); // unmarks it, and this save works
  assert.equal(canReload(), true, 'everything is saved again');
  reset.click();
  assert.equal(text(reset), 'Confirm reset — erase progress');
  assert.equal(canReload(), false, 'a reset is waiting for its confirming click');
  cnn.click(); cnn.click(); // any save disarms the reset
  assert.equal(text(reset), 'Reset local progress');
  assert.equal(canReload(), true);
  fire(document.getElementById('cnn-lab').querySelector('select'), 'keydown', {key: 'Tab'});
  assert.equal(canReload(), false, 'the learner has started working in a lab');
  assert.deepEqual(JSON.parse(saved.get(STORAGE_KEY)), {completed: [], answers: {}});
  $('.privacy-details').open = false;
});

test('CNN lab: the outlined window and the worked dot product follow the chosen output cell, for every filter, stride and padding', () => {
  const lab = document.getElementById('cnn-lab');
  const filters = {edge: [[-1, 0, 1], [-1, 0, 1], [-1, 0, 1]], blur: Array.from({length: 3}, () => [1 / 9, 1 / 9, 1 / 9]), identity: [[0, 0, 0], [0, 1, 0], [0, 0, 0]], sharpen: [[0, -1, 0], [-1, 5, -1], [0, -1, 0]]};
  lab.querySelector('#cnn-reset').click();
  lab.querySelector('[data-pixel="2,1"]').click(); // one extra lit pixel, so a misplaced window changes the sums
  const image = [[0, 0, 1, 1, 1], [0, 0, 1, 1, 1], [0, 1, 1, 1, 1], [0, 0, 1, 1, 1], [0, 0, 1, 1, 1]];
  assert.equal(lab.querySelector('[data-pixel="2,1"]').getAttribute('aria-pressed'), 'true');
  for (const [name, filter] of Object.entries(filters)) for (const stride of [1, 2]) for (const padding of [0, 1]) {
    choose(lab.querySelector('#kernel'), name);
    choose(lab.querySelector('#stride'), stride);
    choose(lab.querySelector('#padding'), padding);
    const side = Math.floor((5 + 2 * padding - 3) / stride) + 1, setting = `${name}, stride ${stride}, padding ${padding}`;
    assert.equal(text(lab.querySelector('#map-size')), `${side} × ${side}`, setting);
    assert.equal(lab.querySelectorAll('#feature-map [data-output]').length, side * side, setting);
    for (let row = 0; row < side; row++) for (let col = 0; col < side; col++) {
      lab.querySelector(`[data-output="${row},${col}"]`).click();
      const window = [], terms = [];
      let sum = 0;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        const i = row * stride - padding + a, j = col * stride - padding + b, inside = i >= 0 && i < 5 && j >= 0 && j < 5;
        if (inside) window.push(`${i},${j}`);
        const pixel = inside ? image[i][j] : 0, weight = filter[a][b];
        terms.push(`${pixel}×(${weight === 1 / 9 ? '⅑' : weight})`);
        sum += pixel * weight;
      }
      const cell = `${setting}, output (${row + 1}, ${col + 1})`;
      assert.deepEqual(lab.querySelectorAll('#pixels .window').map(pixel => pixel.dataset.pixel), window, `${cell}: outlined pixels`);
      const [shownTerms, shownSum] = text(lab.querySelector('#cnn-calculation .formula')).split(' = ');
      assert.equal(shownTerms, terms.join(' + '), cell);
      close(shownSum, [sum], cell);
      const output = lab.querySelector(`[data-output="${row},${col}"]`);
      close(text(output), [sum], `${cell}: feature-map cell`);
      assert.equal(output.getAttribute('aria-pressed'), 'true', cell);
      assert.match(text(lab.querySelector('#cnn-calculation .note')), new RegExp(`^Output side = ⌊\\(5 \\+ 2×${padding} − 3\\) / ${stride}⌋ \\+ 1 = ${side}\\.`), cell);
    }
  }
  lab.querySelector('#cnn-clear').click();
  assert.ok(lab.querySelectorAll('[data-pixel]').every(pixel => text(pixel) === '0'));
  for (const id of ['#kernel', '#stride', '#padding']) choose(lab.querySelector(id), lab.querySelector(`${id} option`).getAttribute('value'));
  lab.querySelector('#cnn-reset').click();
});

test('Attention lab: QKᵀ, logits, weights, output and the two-head result match the formulas for every query and option', () => {
  const lab = document.getElementById('attention-lab');
  const Q = [[1, 0], [0, 1], [1, 1], [0.5, 1]], K = [[1, 0], [0, 1], [1, 1], [-1, 1]], V = [[1, 0], [0, 2], [1, 1], [2, -1]];
  const times = (M, W) => M.map(row => W[0].map((_, j) => row.reduce((total, value, k) => total + value * W[k][j], 0)));
  // Head B's fixed projections, as the lab's note states them.
  const projections = {base: [Q, K, V], second: [times(Q, [[1, 0], [0, -1]]), times(K, [[0, 1], [1, 0]]), times(V, [[0.5, 0], [0, 1]])]};
  function attend([q, k, v], query, {causal, scaled, temperature}) {
    const dots = k.map(key => q[query][0] * key[0] + q[query][1] * key[1]);
    const logits = dots.map((dot, j) => causal && j > query ? -Infinity : dot / ((scaled ? Math.SQRT2 : 1) * temperature));
    const top = Math.max(...logits), exps = logits.map(logit => Math.exp(logit - top)), total = exps.reduce((a, b) => a + b);
    const weights = exps.map(e => e / total);
    return {dots, logits, weights, output: [0, 1].map(c => weights.reduce((sum, w, j) => sum + w * v[j][c], 0))};
  }
  const checkbox = (id, on) => { const box = lab.querySelector(id); box.checked = on; fire(box, 'change'); };
  const slider = lab.querySelector('#temperature');
  for (const causal of [false, true]) for (const scaled of [true, false]) for (const temperature of [1, 0.5]) for (const head of ['base', 'second']) {
    checkbox('#causal', causal);
    checkbox('#scaled', scaled);
    type(slider, temperature);
    choose(lab.querySelector('#attention-head'), head);
    const options = {causal, scaled, temperature};
    for (let query = 0; query < 4; query++) {
      lab.querySelector(`[data-query="${query}"]`).click();
      const setting = `${head}, query ${query}, causal ${causal}, scaled ${scaled}, temperature ${temperature}`;
      const expected = attend(projections[head], query, options);
      const [rowLine, logitLine] = lines(lab.querySelector('#attention-work .formula'));
      close(rowLine, expected.dots, `${setting}: QKᵀ row`);
      close(logitLine, expected.logits, `${setting}: logits`);
      close(lab.querySelectorAll('#attention-work .score-row').map(row => text(row.children.at(-1))).join(' '), expected.weights.map(w => 100 * w), `${setting}: weights`);
      close(text(lab.querySelector('#attention-work .output-vector')), expected.output, `${setting}: output`);
      const heat = lab.querySelectorAll(`[data-heat-query="${query}"]`);
      assert.ok(heat.every(cell => cell.classList.contains('selected-row')), setting);
      assert.equal(heat.filter(cell => cell.classList.contains('masked')).length, causal ? 3 - query : 0, setting);
      close(heat.filter(cell => !cell.classList.contains('masked')).map(text).join(' '), expected.weights.filter(Number.isFinite).filter((_, j) => !(causal && j > query)), `${setting}: heatmap row`);
      // Wᴼ = [[1,0],[0,1],[0.5,0],[0,0.5]] turns the concatenated heads into A + 0.5 B.
      const A = attend(projections.base, query, options).output, B = attend(projections.second, query, options).output;
      const [shownA, shownB, shownFinal] = text(lab.querySelector('#multi-head')).split(/ ⊕ B | → /);
      close(shownA, A, `${setting}: head A`);
      close(shownB, B, `${setting}: head B`);
      close(shownFinal, A.map((a, i) => a + 0.5 * B[i]), `${setting}: A + 0.5 B`);
    }
  }
  checkbox('#causal', false); checkbox('#scaled', true); type(slider, 1); choose(lab.querySelector('#attention-head'), 'base');

  // Changing only a value vector changes the output, not the weights (guided experiment 03).
  lab.querySelector('[data-query="0"]').click();
  const weights = () => lab.querySelectorAll('#attention-work .score-row').map(row => text(row.children.at(-1)));
  const before = weights();
  const valueInput = lab.querySelector('[data-matrix="V"][data-i="0"][data-j="0"]');
  type(valueInput, 3);
  assert.deepEqual(weights(), before);
  close(text(lab.querySelector('#attention-work .output-vector')), attend([Q, K, [[3, 0], ...V.slice(1)]], 0, {causal: false, scaled: true, temperature: 1}).output, 'edited V');
  // An out-of-range entry is flagged and leaves the last valid calculation on screen.
  const shown = text(lab.querySelector('#attention-work'));
  type(valueInput, 9);
  assert.equal(valueInput.getAttribute('aria-invalid'), 'true');
  assert.notEqual(text(lab.querySelector('#matrix-error')), '');
  assert.equal(text(lab.querySelector('#attention-work')), shown);
  lab.querySelector('#reset-matrices').click();
  assert.equal(valueInput.value, '1');
  assert.equal(text(lab.querySelector('#matrix-error')), '');
  lab.querySelector('[data-query="1"]').click();
});

test('LayerNorm lab: every step divides by √(σ² + ε), and an invalid entry keeps the last valid result', () => {
  const lab = document.getElementById('normalization-lab');
  const [gammaSlider, betaSlider] = lab.querySelectorAll('.normalization-controls input[type="range"]');
  const x = [1, 2, 3, 4], s = [0.5, -0.5, 1, -1];
  for (const epsilon of ['0.00001', '0.001', '0.1']) for (const [gamma, beta] of [[1, 0], [-0.5, 1.5]]) {
    choose(lab.querySelector('.normalization-controls select'), epsilon);
    type(gammaSlider, gamma);
    type(betaSlider, beta);
    const r = x.map((value, i) => value + s[i]);
    const mean = r.reduce((a, b) => a + b) / r.length;
    const variance = r.reduce((total, value) => total + (value - mean) ** 2, 0) / r.length;
    const denominator = Math.sqrt(variance + Number(epsilon));
    const z = r.map(value => (value - mean) / denominator), output = z.map(value => gamma * value + beta);
    const setting = `ε ${epsilon}, γ ${gamma}, β ${beta}`;
    const [add, measure, normalize] = lab.querySelectorAll('.normalization-steps .formula').map(lines);
    close(add[1], r, `${setting}: r`);
    close(measure.join(' ').replace(/σ²/g, 'variance'), [mean, variance], `${setting}: μ and σ²`);
    assert.equal(normalize[0], 'z = (r − μ) / √(σ² + ε)');
    close(normalize[1], [denominator], `${setting}: denominator`);
    close(text(lab.querySelector('.normalization-output strong')), output, `${setting}: output`);
    lab.querySelectorAll('.normalization-table tbody tr').forEach((row, i) => {
      close(row.children.slice(1).map(text).join(' '), [r[i], r[i] - mean, z[i], output[i]], `${setting}: table row ${i + 1}`);
    });
  }
  const first = lab.querySelector('[data-vector="x"][data-coordinate="0"]');
  const result = text(lab.querySelector('.normalization-working'));
  for (const bad of ['25', '', 'two']) {
    type(first, bad);
    assert.equal(first.getAttribute('aria-invalid'), 'true', `"${bad}"`);
    assert.notEqual(text(lab.querySelector('.error')), '');
    assert.equal(text(lab.querySelector('.normalization-working')), result, `"${bad}" must keep the last valid result`);
  }
  lab.querySelector('[data-action="reset-normalization"]').click();
  assert.equal(first.value, '1');
  assert.equal(first.getAttribute('aria-invalid'), 'false');
  choose(lab.querySelector('.normalization-controls select'), '0.00001');
  type(gammaSlider, 1);
  type(betaSlider, 0);
});

test('Context-cost lab: shows n² × heads × bytes for presets and selections, and rejects invalid lengths', () => {
  const lab = document.getElementById('complexity-lab');
  const field = lab.querySelector('input[type="number"]');
  const [heads, precision] = lab.querySelectorAll('.complexity-controls select');
  const size = bytes => bytes >= 2 ** 30 ? `${Number((bytes / 2 ** 30).toFixed(2))} GiB` : bytes >= 2 ** 20 ? `${Number((bytes / 2 ** 20).toFixed(2))} MiB` : bytes >= 1024 ? `${Number((bytes / 1024).toFixed(2))} KiB` : `${bytes} bytes`;
  const check = (n, h, b) => {
    const elements = n * n * h, setting = `n ${n}, ${h} heads, ${b} bytes`;
    assert.deepEqual(lab.querySelectorAll('.complexity-metric strong').map(text), [elements.toLocaleString('en-US'), size(elements * b)], setting);
    assert.ok(text(lab.querySelector('.complexity-results .formula')).endsWith(`Double to ${(2 * n).toLocaleString('en-US')} tokens → ${size(4 * elements * b)} (4×)`), setting);
  };
  check(1024, 8, 2);
  for (const preset of [512, 2048, 8192, 32768]) {
    lab.querySelector(`[data-tokens="${preset}"]`).click();
    assert.equal(field.value, String(preset));
    assert.deepEqual(lab.querySelectorAll('[data-tokens]').filter(button => button.getAttribute('aria-pressed') === 'true').map(button => button.dataset.tokens), [String(preset)]);
    check(preset, 8, 2);
  }
  choose(heads, 16);
  choose(precision, 4);
  check(32768, 16, 4); // 64 GiB, the figure in docs/VALIDATION.md
  for (const n of [1, 20, 1000]) { type(field, n); check(n, 16, 4); }
  for (const bad of ['0', '2.5', '', '40000']) {
    type(field, bad);
    assert.equal(field.getAttribute('aria-invalid'), 'true', `"${bad}"`);
    assert.notEqual(text(lab.querySelector('.error')), '');
    check(1000, 16, 4);
  }
  type(field, 1024); choose(heads, 8); choose(precision, 2);
  assert.equal(field.getAttribute('aria-invalid'), 'false');
  check(1024, 8, 2);
});

test('√dₖ lab: the variance line and both softmax panels follow the chosen dₖ', () => {
  const lab = document.getElementById('scaling-lab');
  const select = lab.querySelector('select');
  for (const d of [1, 4, 64, 512]) {
    choose(select, d);
    const sample = dotProductSpread({dimensions: d});
    const [rawSigma, scaledSigma] = lab.querySelectorAll('.scaling-results .complexity-metric strong').map(text);
    close(rawSigma, [sample.std], `dₖ ${d}: σ`);
    close(scaledSigma, [sample.scaledStd], `dₖ ${d}: scaled σ`);
    assert.ok(text(lab.querySelector('.scaling-results .formula')).startsWith(`Var(q · k) = Σᵢ Var(qᵢkᵢ) = ${d} × 1 = ${d} → σ = √${d} ≈ ${Number(Math.sqrt(d).toFixed(3))}`), `dₖ ${d}`);
    const panels = lab.querySelectorAll('.scaling-panel');
    assert.equal(panels.length, 2);
    panels.forEach((panel, i) => {
      const top = i === 0 ? Math.sqrt(d) : 1, p = Math.exp(top) / (Math.exp(top) + 3), other = 1 / (Math.exp(top) + 3), setting = `dₖ ${d}, ${i ? 'scaled' : 'unscaled'}`;
      close(text(panel.querySelector('.formula')), [top, 0, 0, 0], `${setting}: scores`);
      close(panel.querySelectorAll('.score-row').map(row => text(row.children.at(-1))).join(' '), [p, other, other, other], `${setting}: weights`);
      const widths = panel.querySelectorAll('.score-bar').map(bar => Number(/width:([\d.]+)%/.exec(bar.getAttribute('style'))[1]));
      assert.ok(Math.abs(widths.reduce((a, b) => a + b) - 100) < 0.05, `${setting}: bar widths ${widths}`);
      const approximations = [...text(panel.querySelector('.note')).matchAll(/≈ (-?[\d.]+(?: × 10[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)?)/g)].map(match => match[1]);
      close(approximations.join(' '), [p, p * (1 - p)], `${setting}: p and its slope p(1 − p)`);
    });
    if (d === 1) assert.equal(text(panels[0]).replace(/^.*?GAP √1 ≈ 1/, ''), text(panels[1]).replace(/^.*?GAP 1/, ''), 'at dₖ = 1 the panels coincide');
  }
  choose(select, 64);
  // On a 320px phone this select is 250px wide, which leaves about 205px for the chosen label at 16px, the size that
  // keeps iPhone Safari from zooming: some 27 characters at about 7.6px each. "64 · one head of the base model" (31)
  // was cut off. The limit leaves room for a wider font.
  const labels = select.querySelectorAll('option').map(text);
  for (const label of labels) assert.ok(label.length <= 22, `"${label}" is too long for a small phone`);
  // The two values from the paper's base model still say what they are.
  assert.deepEqual(labels.filter(label => /\D/.test(label)).map(label => parseInt(label, 10)), [64, 512]);
});

test('Transformer map: clicking a block shows that block and presses only its button', () => {
  const map = document.getElementById('transformer-map');
  const blocks = map.querySelectorAll('[data-block]');
  const pressed = () => map.querySelectorAll('[aria-pressed="true"]');
  assert.deepEqual(pressed().map(button => button.dataset.block), ['cross']);
  const titles = new Map();
  for (const [index, button] of blocks.entries()) {
    button.click();
    // Several blocks share a name, so the pressed elements are identified by their position among the blocks.
    assert.deepEqual(pressed().map(element => blocks.indexOf(element)), [index], `block ${index + 1} (${button.dataset.block})`);
    const title = text(map.querySelector('.arch-info h3'));
    assert.equal(titles.get(button.dataset.block) ?? title, title, 'repeated blocks show the same explanation');
    titles.set(button.dataset.block, title);
  }
  assert.equal(new Set(titles.values()).size, titles.size, 'each kind of block has its own explanation');
  assert.match(titles.get('masked'), /Masked/);
  assert.match(titles.get('cross'), /Encoder–decoder/);
  map.querySelector('[data-block="cross"]').click();
});

test('Position lab: the table, the example and the offset check follow the slider', () => {
  const lab = document.getElementById('position-lab');
  const slider = lab.querySelector('input[type="range"]');
  const encode = (p, d) => (d % 2 ? Math.cos : Math.sin)(p / 10000 ** (2 * Math.floor(d / 2) / 8));
  let rotation;
  for (const p of [0, 4, 37, 100]) {
    type(slider, p);
    assert.deepEqual(lab.querySelectorAll('thead th').map(text), ['Dimension', `p = ${p}`, `p = ${p + 1}`]);
    const rows = lab.querySelectorAll('tbody tr');
    assert.equal(rows.length, 8);
    rows.forEach((row, d) => close(row.children.slice(1).map(text).join(' '), [encode(p, d), encode(p + 1, d)], `p ${p}, dimension ${d}`));
    const current = lab.querySelectorAll('circle.position-current').map(circle => Number(circle.getAttribute('cx')));
    current.forEach((cx, d) => assert.ok(Math.abs(cx - (90 + (encode(p, d) + 1) * 160)) < 1e-9, `p ${p}: dot ${d}`));
    close(text(lab.querySelector('.position-example')).split('≈')[1].split('.').slice(0, 2).join('.'), [Math.sin(p / 10)], `p ${p}: sin(p / 10)`);
    const offset = lines(lab.querySelector('.position-offset .formula'));
    for (const pair of [0, 1]) {
      const [header, from, rotated, target] = offset.slice(pair * 5, pair * 5 + 4);
      const w = 1 / 10000 ** (2 * pair / 8);
      close(header.split('R = ')[1], [Math.cos(w), Math.sin(w), -Math.sin(w), Math.cos(w)], `p ${p}, pair ${pair}: R`);
      close(from, [p, encode(p, 2 * pair), encode(p, 2 * pair + 1)], `p ${p}, pair ${pair}: from`);
      close(rotated.replace('R × that pair: ', ''), [encode(p + 1, 2 * pair), encode(p + 1, 2 * pair + 1)], `p ${p}, pair ${pair}: rotated`);
      close(target, [p + 1, encode(p + 1, 2 * pair), encode(p + 1, 2 * pair + 1)], `p ${p}, pair ${pair}: target`);
    }
    // R depends only on the offset and the pair's frequency, never on the position.
    const matrices = offset.filter(line => line.includes('R = ')).join(' | ');
    assert.equal(rotation ?? matrices, matrices);
    rotation = matrices;
  }
  type(slider, 4);
});

test('RNN lab: the chain-rule factors are wₕ(1 − hₖ²) and multiply to ∂hₜ/∂h₀', () => {
  const lab = document.getElementById('rnn-lab');
  lab.querySelector('[data-action="all"]').click();
  let hidden = 0, gradient = 1;
  const factors = [];
  [1, 0.5, -1, 0.8].forEach((input, step) => {
    hidden = Math.tanh(0.8 * input + 0.7 * hidden);
    factors.push(0.7 * (1 - hidden ** 2));
    gradient *= factors.at(-1);
    lab.querySelector(`button[data-index="${step}"]`).click();
    close(text(lab.querySelector('.sequence-product')), [...factors, gradient], `step ${step + 1}`);
  });
  lab.querySelector('[data-action="reset"]').click();
});

test('Learning tools: results link to their chapters, Enter and Escape work, and every glossary and guided link has a target', () => {
  const tools = document.getElementById('learning-tools');
  const input = tools.querySelector('input[type="search"]'), clear = tools.querySelector('.learning-clear');
  const links = () => tools.querySelectorAll('.learning-search-results a');
  const chapters = CHAPTERS.map(id => `#${id}`);
  assert.deepEqual(links().map(link => link.href), chapters);
  assert.equal(clear.hidden, true);
  type(input, 'gradient');
  assert.equal(links()[0].href, '#rnn');
  assert.equal(text(links()[0].querySelector('strong')), 'Gradient');
  assert.ok(text(tools.querySelector('.learning-search-status')).startsWith(`${links().length} match`));
  assert.equal(clear.hidden, false);
  assert.equal(fire(tools.querySelector('form'), 'submit'), false, 'Enter must not submit the query anywhere');
  focused(links()[0], 'Enter moves to the first result');
  fire(input, 'keydown', {key: 'Escape'});
  assert.equal(input.value, '');
  assert.deepEqual(links().map(link => link.href), chapters);
  type(input, 'softmax');
  clear.click();
  assert.equal(input.value, '');
  focused(input, 'Clear returns to the search box');
  const {glossary, experiments} = learningContent();
  assert.equal(tools.querySelectorAll('.glossary-item').length, glossary.length);
  assert.equal(tools.querySelectorAll('.guided-experiment').length, experiments.length);
  for (const link of tools.querySelectorAll('.glossary-item a, .guided-experiment a')) assert.ok(document.getElementById(link.href.slice(1)), `${link.href} has no target`);
});

test('Chapter progress: marking a chapter updates its button, dot and summary, and is saved', () => {
  const button = $('[data-complete="cnn"]');
  button.click();
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(text($('#progress-summary')), `1 of ${CHAPTERS.length} explored`);
  assert.ok($('#progress-dots a[href="#cnn"]').classList.contains('done'));
  assert.deepEqual(JSON.parse(saved.get(STORAGE_KEY)).completed, ['cnn']);
  button.click();
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(text($('#progress-summary')), `0 of ${CHAPTERS.length} explored`);
  assert.ok(!$('#progress-dots a[href="#cnn"]').classList.contains('done'));
  assert.deepEqual(JSON.parse(saved.get(STORAGE_KEY)).completed, []);
});

test('Quiz: an answer shows its feedback and moves focus to "Try again"; retrying clears it; navigation focuses the question', () => {
  const panel = $('#quiz');
  const choices = () => panel.querySelectorAll('[data-answer]');
  const retry = () => panel.querySelectorAll('button').find(button => text(button) === 'Try again');
  const heading = () => text(panel.querySelector('.quiz-main .eyebrow'));
  const [first] = quiz, wrong = (first.answer + 1) % first.choices.length;
  choices()[wrong].click();
  assert.ok(choices()[wrong].classList.contains('incorrect'));
  assert.ok(choices()[first.answer].classList.contains('correct'));
  assert.ok(choices().every(choice => choice.disabled), 'an answered question is locked until Try again');
  assert.ok(panel.querySelector('.quiz-feedback'), 'feedback is shown');
  assert.ok(retry(), 'Try again is offered');
  focused(retry(), 'an answer moves focus to Try again');
  assert.equal(JSON.parse(saved.get(STORAGE_KEY)).answers[first.id], wrong);
  retry().click();
  assert.ok(!panel.querySelector('.quiz-feedback'), 'retrying removes the feedback');
  assert.ok(choices().every(choice => !choice.disabled));
  focused($('#quiz-question'), 'Try again returns to the question');
  assert.equal(JSON.parse(saved.get(STORAGE_KEY)).answers[first.id], undefined);
  choices()[first.answer].click();
  assert.equal(text(panel.querySelector('.quiz-sidebar h3')), `1 / ${quiz.length} understood`);
  assert.ok(panel.querySelector('[data-question="0"]').classList.contains('solved'));
  retry().click();
  panel.querySelector('#quiz-next').click();
  assert.match(heading(), /QUESTION 02$/);
  focused($('#quiz-question'), 'Next moves to the new question');
  panel.querySelector('#quiz-prev').click();
  assert.match(heading(), /QUESTION 01$/);
  panel.querySelector(`[data-question="${quiz.length - 1}"]`).click();
  assert.match(heading(), new RegExp(`QUESTION ${quiz.length}$`));
  panel.querySelector('#quiz-next').click();
  assert.match(heading(), /QUESTION 01$/, 'Next on the last question returns to the first');
});

test('Guided revision: the sidebar counts mistakes and unanswered questions, and its button opens a mistake before an unanswered question', () => {
  const panel = $('#quiz'), third = quiz[2], wrong = (third.answer + 1) % third.choices.length;
  const summary = () => text(panel.querySelector('.revision-summary')), suggestion = () => panel.querySelector('#quiz-recommended');
  const heading = () => text(panel.querySelector('.quiz-main .eyebrow'));
  assert.equal(summary(), `0 to revisit · ${quiz.length} unanswered`);
  assert.equal(text(suggestion()), 'Continue unanswered →');
  // A wrong answer to question 3 is suggested ahead of the unanswered questions 1 and 2.
  panel.querySelector('[data-question="2"]').click();
  panel.querySelectorAll('[data-answer]')[wrong].click();
  assert.equal(summary(), `1 to revisit · ${quiz.length - 1} unanswered`);
  assert.equal(text(suggestion()), 'Revisit a mistake →');
  panel.querySelector('[data-question="0"]').click();
  suggestion().click();
  assert.match(heading(), /QUESTION 03$/);
  focused($('#quiz-question'), 'the suggestion moves to its question');
  assert.ok(panel.querySelector('.quiz-feedback'), 'its explanation is shown again');
  assert.equal(JSON.parse(saved.get(STORAGE_KEY)).answers[third.id], wrong, 'following a suggestion does not clear the answer');
  panel.querySelector('#quiz-retry').click(); // only Try again does
  assert.equal(summary(), `0 to revisit · ${quiz.length} unanswered`);
  // With no mistake left, the suggestion is the first unanswered question.
  suggestion().click();
  assert.match(heading(), /QUESTION 01$/);
});

test('Attention lab: every empty or out-of-range Q/K/V coordinate is marked invalid, not only the first', () => {
  const lab = document.getElementById('attention-lab');
  const cell = (name, i, j) => lab.querySelector(`[data-matrix="${name}"][data-i="${i}"][data-j="${j}"]`);
  const flagged = () => lab.querySelectorAll('[data-matrix]').filter(input => input.getAttribute('aria-invalid') === 'true').map(input => input.getAttribute('aria-label'));
  const shown = text(lab.querySelector('#attention-work'));
  type(cell('Q', 0, 0), 9);
  type(cell('K', 0, 0), 9); // the field just edited is out of range too
  assert.deepEqual(flagged(), ['Q The coordinate 1', 'K The coordinate 1']);
  type(cell('Q', 0, 0), 1); // fixing Q leaves K flagged
  assert.deepEqual(flagged(), ['K The coordinate 1']);
  type(cell('Q', 0, 0), ''); // emptying Q while retyping it does not unflag K
  type(cell('V', 3, 1), -7);
  assert.deepEqual(flagged(), ['Q The coordinate 1', 'K The coordinate 1', 'V down coordinate 2']);
  assert.notEqual(text(lab.querySelector('#matrix-error')), '');
  assert.equal(text(lab.querySelector('#attention-work')), shown, 'the last valid calculation stays on screen');
  for (const [name, i, j, value] of [['Q', 0, 0, 1], ['K', 0, 0, 1], ['V', 3, 1, -1]]) type(cell(name, i, j), value);
  assert.deepEqual(flagged(), []);
  assert.equal(text(lab.querySelector('#matrix-error')), '');
  lab.querySelector('#reset-matrices').click();
});

test('Learning tools: symbols alone match nothing, and the lab notation q · k finds the concepts that use it', () => {
  const tools = document.getElementById('learning-tools');
  const input = tools.querySelector('input[type="search"]'), status = () => text(tools.querySelector('.learning-search-status'));
  const titles = () => tools.querySelectorAll('.learning-search-results a strong').map(text);
  for (const query of ['√', '???', '×', '\u200b']) {
    type(input, query);
    assert.match(status(), /^0 matches\./, JSON.stringify(query));
    assert.deepEqual(titles(), [], JSON.stringify(query));
  }
  type(input, 'q · k'); // the label RAW SCORES q · k in Experiment 04
  assert.deepEqual(titles(), ['Scaled dot product (÷ √dₖ)', 'Query (Q)', 'Key (K)']);
  assert.match(status(), /^3 matches\./);
  type(input, 'QKᵀ');
  assert.deepEqual(titles(), ['Key (K)']);
  type(input, 'a filter'); // an article is not a symbol, and neither is the s of a possessive
  assert.deepEqual(titles(), ['CNN · local patterns', 'Convolution', 'Receptive field', 'Translation equivariance']);
  assert.match(status(), /^4 matches\./);
  type(input, 'RNN’s memory');
  assert.deepEqual(titles(), ['RNN · recurrent memory', 'Hidden state']);
  fire(input, 'keydown', {key: 'Escape'});
});

test('Learning tools: a guided card that sends you to a lab by its number also names that lab, and its link reaches it', () => {
  // The cards are numbered GUIDED EXPERIMENT 01–06, so a bare "Experiment 04" reads as card 04, not the lab.
  const labs = new Map();
  for (const eyebrow of document.querySelectorAll('.lab-topbar .eyebrow')) {
    const [, number, title] = /^EXPERIMENT (\d\d) \/ (.+)$/.exec(text(eyebrow));
    labs.set(number, {title, lab: eyebrow.closest('.lab')});
  }
  assert.equal(labs.size, 7);
  let cited = 0;
  for (const card of document.querySelectorAll('.guided-experiment')) {
    const [eyebrow, ...rest] = card.children, name = text(eyebrow), body = rest.map(text).join(' ');
    for (const [, number] of body.matchAll(/\bExperiment (\d\d)\b/gi)) {
      cited++;
      const {title, lab} = labs.get(number) ?? assert.fail(`${name} cites Experiment ${number}, which no lab has`);
      assert.ok(body.toLowerCase().includes(title.toLowerCase()), `${name} cites Experiment ${number} without naming it ("${title}")`);
      assert.ok(document.getElementById(card.querySelector('a').href.slice(1)).contains(lab), `${name}: its link does not reach Experiment ${number}`);
    }
  }
  assert.ok(cited >= 2, 'the √dₖ and position cards cite their labs');
});

test('Lessons: text that sends you to a lab by its number names that lab too', () => {
  // The lessons sit below the same GUIDED EXPERIMENT 01–06 cards: "in Experiment 04, predict…" in the Practice lesson
  // read as card 04, the CNN shift experiment, not as the √dₖ lab.
  const labs = new Map(document.querySelectorAll('.lab-topbar .eyebrow').map(eyebrow => /^EXPERIMENT (\d\d) \/ (.+)$/.exec(text(eyebrow)).slice(1)));
  assert.equal(labs.size, 7);
  const cited = [];
  for (const lesson of document.querySelectorAll('[data-lesson] .lesson-body')) {
    const body = text(lesson), chapter = lesson.closest('[data-lesson]').dataset.lesson;
    for (const {0: mention, 1: number, index} of body.matchAll(/\bExperiment (\d\d)\b/gi)) {
      cited.push(number);
      assert.ok(labs.has(number), `the ${chapter} lesson cites Experiment ${number}, which no lab has`);
      const named = `“${mention} / ${labs.get(number)}”`;
      assert.equal(body.slice(index - 1, index - 1 + named.length).toLowerCase(), named.toLowerCase(), `the ${chapter} lesson cites Experiment ${number} without its name`);
    }
  }
  assert.deepEqual(cited.sort(), ['04', '04', '05', '05', '06', '07']);
});

test('Storage: when a save fails, the page says progress is not saved, beside the progress and in the opened privacy panel', () => {
  const rail = $('.chapter-rail'), privacy = $('.privacy-details'), cnn = $('[data-complete="cnn"]'), rnn = $('[data-complete="rnn"]');
  // The rail is far up the page from a learner who marks a chapter or answers a question, so a note straight after
  // each chapter button and after the quiz says it too, once a change made there was not saved.
  const warnings = document.querySelectorAll('.storage-warning'), next = element => element.parentElement.children.at(element.parentElement.children.indexOf(element) + 1);
  const controls = [...document.querySelectorAll('[data-complete]'), $('#quiz')];
  const shown = () => controls.filter(control => shownText(next(control)) === 'Not saved on this browser').map(control => control.dataset.complete ?? 'quiz');
  assert.equal(warnings.length, CHAPTERS.length + 2);
  assert.ok(warnings.includes(rail.querySelector('[role="alert"]')) && controls.every(control => warnings.includes(next(control))));
  assert.equal(warnings.filter(warning => warning.getAttribute('role') === 'alert').length, 1, 'a failed save is announced once');
  assert.ok(warnings.every(warning => warning.hidden), 'no warning while saving works');
  assert.doesNotMatch(shownText(rail), /not saved/i);
  assert.equal(privacy.open, false, 'the privacy panel starts closed');
  failingWrites(() => cnn.click());
  assert.equal(text($('#progress-summary')), `1 of ${CHAPTERS.length} explored`);
  assert.match(shownText(rail), /not saved/i, 'the progress rail says the mark is not saved');
  // Only under the button just pressed: a note under an earlier chapter would push this one down the page.
  assert.deepEqual(shown(), ['cnn']);
  failingWrites(() => $('#quiz [data-answer]').click());
  assert.deepEqual(shown(), ['cnn', 'quiz']);
  failingWrites(() => $('#quiz-retry').click());
  assert.deepEqual(shown(), ['cnn', 'quiz']);
  assert.match(shownText($('#sources')), /Browser storage is unavailable or unreadable/, 'the status is rendered, not left in a closed panel');
  // Another tab saves while this one holds unsaved work. That warning is shown too, even after the learner closed the panel.
  privacy.open = false;
  otherTab({completed: [], answers: {}});
  assert.match(shownText($('#sources')), /Another tab updated saved progress\. Your unsaved work remains here; export it before leaving\./);
  assert.equal(cnn.getAttribute('aria-pressed'), 'true', 'the unsaved mark is kept');
  // The next save works: the unsaved mark is stored with it, and the warning goes.
  rnn.click();
  assert.deepEqual(JSON.parse(saved.get(STORAGE_KEY)).completed, ['cnn', 'rnn']);
  assert.doesNotMatch(shownText(rail), /not saved/i);
  assert.ok(warnings.every(warning => warning.hidden), 'every warning goes once a save works');
  assert.match(shownText($('#sources')), /Progress is saved on this browser only\./);
  cnn.click(); rnn.click(); privacy.open = false;
});

test('Stale tab: an answer or chapter mark the learner re-applies after another tab undid it is saved, and focus moves to "Try again"', () => {
  const panel = $('#quiz'), [first] = quiz;
  const choice = i => panel.querySelectorAll('[data-answer]')[i], retry = () => panel.querySelector('#quiz-retry');
  assert.match(text(panel.querySelector('.quiz-main .eyebrow')), /QUESTION 01$/);
  choice(first.answer).click();
  assert.equal(JSON.parse(saved.get(STORAGE_KEY)).answers[first.id], first.answer);
  failingWrites(() => retry().click()); // this tab now holds unsaved work
  assert.equal(shownText($('[data-not-saved="quiz"]')), 'Not saved on this browser', 'a note under the quiz says the retry was not saved');
  otherTab({completed: [], answers: {}}); // another tab retries the same question
  choice(first.answer).click(); // the answer this tab last saved
  assert.ok(retry(), 'the answer is shown');
  focused(retry(), 'the answer moves focus to Try again');
  assert.equal(JSON.parse(saved.get(STORAGE_KEY)).answers[first.id], first.answer, 'the answer is saved');
  retry().click();
  const rnn = $('[data-complete="rnn"]');
  rnn.click();
  failingWrites(() => rnn.click()); // unmarking it is not saved
  otherTab({completed: [], answers: {}}); // another tab unmarks it
  rnn.click(); // the learner marks it again
  assert.equal(rnn.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(JSON.parse(saved.get(STORAGE_KEY)).completed, ['rnn']);
  rnn.click(); $('.privacy-details').open = false;
});

test('Stale tab: what this tab set before another tab\'s change gives way to that change, and what it set after it is saved', () => {
  const chapter = id => $(`[data-complete="${id}"]`), stored = () => JSON.parse(saved.get(STORAGE_KEY));
  const panel = $('#quiz'), [first] = quiz, answered = {[first.id]: 0};
  assert.deepEqual(stored(), {completed: [], answers: {}});
  // Marked and saved here. Unmarking it and marking it again are not saved, and then the other tab unmarks it. This
  // tab's two clicks changed nothing and came first, so its next save must not put the mark back.
  chapter('cnn').click();
  failingWrites(() => { chapter('cnn').click(); chapter('cnn').click(); });
  otherTab({completed: [], answers: {}});
  chapter('rnn').click(); // this save works
  assert.deepEqual(stored().completed, ['rnn']);
  assert.equal(chapter('cnn').getAttribute('aria-pressed'), 'false', 'the other tab\'s later unmark stands');
  // The same for a mark the other tab adds after this tab marked and unmarked the chapter (which the other tab had
  // unmarked before), and for an answer it gives after this tab answered the question and retried it.
  otherTab({completed: [], answers: {}});
  failingWrites(() => { chapter('rnn').click(); chapter('rnn').click(); });
  otherTab({completed: ['rnn'], answers: {}});
  panel.querySelector('[data-question="0"]').click();
  failingWrites(() => { panel.querySelectorAll('[data-answer]')[first.answer].click(); panel.querySelector('#quiz-retry').click(); });
  otherTab({completed: ['rnn'], answers: answered});
  chapter('transformer').click(); // this save works
  assert.deepEqual(stored(), {completed: ['rnn', 'transformer'], answers: answered});
  // What the learner sets here after the other tab's change is the newer one. It is saved, also when the other tab
  // goes on to change something else before this tab can save.
  failingWrites(() => chapter('cnn').click()); // this tab now holds unsaved work
  otherTab({completed: ['transformer'], answers: answered}); // the other tab unmarks rnn
  failingWrites(() => { chapter('rnn').click(); chapter('rnn').click(); }); // unmarked and marked again here
  otherTab({completed: ['transformer', 'practice'], answers: answered}); // the other tab marks another chapter
  chapter('cnn').click(); // unmarks it, and this save works
  assert.deepEqual(stored(), {completed: ['transformer', 'practice', 'rnn'], answers: answered});
  assert.equal(chapter('rnn').getAttribute('aria-pressed'), 'true');
  otherTab({completed: [], answers: {}});
  $('.privacy-details').open = false;
});

test('Storage: answers and chapters a newer release saved in another tab survive this tab\'s saves', () => {
  const newer = {completed: ['training'], answers: {'future-checkpoint': 1, [quiz[1].id]: 0}};
  otherTab(newer);
  const cnn = $('[data-complete="cnn"]');
  cnn.click();
  assert.deepEqual(JSON.parse(saved.get(STORAGE_KEY)), {completed: ['training', 'cnn'], answers: newer.answers});
  assert.equal(text($('#progress-summary')), `1 of ${CHAPTERS.length} explored`, 'this release counts only the chapters it has');
  cnn.click();
  assert.deepEqual(JSON.parse(saved.get(STORAGE_KEY)), newer);
  otherTab({completed: [], answers: {}});
});
