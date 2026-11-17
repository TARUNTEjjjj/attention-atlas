import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreBudget, layerNorm, dotProductSpread, softmaxSaturation } from '../src/advanced-math.js';
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('scaling sample: Var(q · k) tracks dₖ, and division by √dₖ restores variance 1', () => {
  for (const dimensions of [1, 2, 8, 64, 512]) {
    const r = dotProductSpread({ dimensions });
    assert.equal(r.samples, 2000);
    assert.equal(r.theoryVariance, dimensions);
    close(r.theoryStd, Math.sqrt(dimensions));
    assert.ok(Math.abs(r.variance / dimensions - 1) < 0.12, `variance ${r.variance} for dₖ = ${dimensions}`);
    close(r.scaledVariance, r.variance / dimensions);
    close(r.scaledStd * Math.sqrt(dimensions), r.std);
    assert.ok(Math.abs(r.mean) < 5 * Math.sqrt(dimensions / r.samples), `mean ${r.mean}`);
  }
  const large = dotProductSpread({ dimensions: 64, samples: 20000, seed: 7 });
  assert.ok(Math.abs(large.variance / 64 - 1) < 0.04, `variance ${large.variance}`);
});
test('scaling sample: the fixed seed makes every learner see the same numbers', () => {
  assert.deepEqual(dotProductSpread({ dimensions: 16 }), dotProductSpread({ dimensions: 16 }));
  assert.notEqual(dotProductSpread({ dimensions: 16, seed: 1 }).variance, dotProductSpread({ dimensions: 16, seed: 2 }).variance);
  assert.equal(dotProductSpread({ dimensions: 16 }).seed, 2017);
});
test('scaling sample: rejects unbounded or malformed requests before sampling', () => {
  for (const dimensions of [0, 4097, 1.5, NaN, Infinity, '64']) assert.throws(() => dotProductSpread({ dimensions }));
  for (const samples of [1, 20001, 2.5]) assert.throws(() => dotProductSpread({ dimensions: 4, samples }));
  for (const seed of [-1, 2 ** 32, 0.5]) assert.throws(() => dotProductSpread({ dimensions: 4, seed }));
});
test('softmax saturation: dₖ = 64 matches the worked example in the lesson', () => {
  const r = softmaxSaturation(64);
  assert.equal(r.gap, 8);
  assert.deepEqual(r.unscaled.scores, [8, 0, 0, 0]);
  assert.deepEqual(r.scaled.scores, [1, 0, 0, 0]);
  close(r.unscaled.weights[0], Math.exp(8) / (Math.exp(8) + 3), 1e-12);
  close(r.scaled.weights[0], Math.E / (Math.E + 3), 1e-12);
  assert.equal(r.unscaled.weights[0].toFixed(3), '0.999');
  assert.equal(r.unscaled.weights[1].toFixed(4), '0.0003');
  assert.equal(r.scaled.weights.map(w => w.toFixed(3)).join(' '), '0.475 0.175 0.175 0.175');
  assert.equal(r.unscaled.slope.toFixed(4), '0.0010');
  assert.equal(r.scaled.slope.toFixed(3), '0.249');
  close(r.scaled.slope, r.scaled.weights[0] * (1 - r.scaled.weights[0]));
});
test('softmax saturation: the unscaled slope collapses as dₖ grows; the scaled one is constant', () => {
  const sizes = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512].map(d => softmaxSaturation(d));
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i].unscaled.slope < sizes[i - 1].unscaled.slope);
  for (const r of sizes) { close(r.scaled.slope, sizes[0].scaled.slope, 1e-15); close(r.unscaled.weights.reduce((a, b) => a + b, 0), 1, 1e-12); }
  assert.deepEqual(sizes[0].unscaled, sizes[0].scaled);
  assert.ok(sizes.at(-1).unscaled.slope < 1e-9);
  for (const bad of [0, 4097, 2.5]) assert.throws(() => softmaxSaturation(bad));
  assert.throws(() => softmaxSaturation(4, 0));
});

test('score budget: known score tensor count and binary units', () => {
  const result = scoreBudget({ tokens: 1024, heads: 8, bytesPerElement: 2 });
  assert.equal(result.elementsPerHead, 1_048_576);
  assert.equal(result.elements, 8_388_608);
  assert.equal(result.bytes, 16_777_216);
  assert.equal(result.mebibytes, 16);
  assert.equal(result.gibibytes, 1 / 64);
});
test('score budget: doubling tokens quadruples storage, while heads and bytes scale linearly', () => {
  const base = scoreBudget({ tokens: 137, heads: 3, bytesPerElement: 2 });
  assert.equal(scoreBudget({ tokens: 274, heads: 3, bytesPerElement: 2 }).bytes, 4 * base.bytes);
  assert.equal(scoreBudget({ tokens: 137, heads: 6, bytesPerElement: 2 }).bytes, 2 * base.bytes);
  assert.equal(scoreBudget({ tokens: 137, heads: 3, bytesPerElement: 4 }).bytes, 2 * base.bytes);
});
test('score budget: largest UI case is 64 GiB, without allocating a tensor', () => {
  const result = scoreBudget({ tokens: 32768, heads: 16, bytesPerElement: 4 });
  assert.equal(result.elements, 17_179_869_184);
  assert.equal(result.gibibytes, 64);
});
test('score budget: rejects invalid dimensions and unsafe arithmetic', () => {
  for (const tokens of [0, -1, .5, NaN, Infinity, '1024']) assert.throws(() => scoreBudget({ tokens, heads: 8, bytesPerElement: 2 }));
  assert.throws(() => scoreBudget({ tokens: 2, heads: 0, bytesPerElement: 2 }));
  assert.throws(() => scoreBudget({ tokens: 2, heads: 8, bytesPerElement: -2 }));
  assert.throws(() => scoreBudget({ tokens: Number.MAX_SAFE_INTEGER, heads: 8, bytesPerElement: 2 }));
});
test('LayerNorm: hand-calculated population mean and variance', () => {
  const result = layerNorm([1, 2, 3, 4], { epsilon: .25 });
  assert.equal(result.mean, 2.5);
  assert.equal(result.variance, 1.25);
  result.normalized.forEach((value, i) => close(value, (i - 1.5) / Math.sqrt(1.5)));
  assert.deepEqual(result.normalized, result.output);
});
test('LayerNorm: identical features stay finite and normalize to zero', () => {
  const result = layerNorm([7, 7, 7, 7], { gamma: 2, beta: -3 });
  assert.equal(result.variance, 0);
  assert.deepEqual(result.normalized, [0, 0, 0, 0]);
  assert.deepEqual(result.output, [-3, -3, -3, -3]);
});
test('LayerNorm: a single feature has zero population variance', () => {
  assert.deepEqual(layerNorm([9]).output, [0]);
});
test('LayerNorm: common offsets do not change the normalized result', () => {
  const ordinary = layerNorm([1, 2, 3, 4]);
  const offset = layerNorm([1e12 + 1, 1e12 + 2, 1e12 + 3, 1e12 + 4]);
  assert.equal(offset.variance, ordinary.variance);
  assert.deepEqual(offset.normalized, ordinary.normalized);
});
test('LayerNorm: positive scaling is approximately invariant when variance dominates epsilon', () => {
  const a = layerNorm([-2, -1, 1, 2]);
  const b = layerNorm([-20, -10, 10, 20]);
  a.normalized.forEach((value, i) => close(value, b.normalized[i], 3e-6));
});
test('LayerNorm: a rounded large mean does not erase centered differences', () => {
  for (const values of [[0, 2], [0, 2, 2]]) {
    const ordinary = layerNorm(values);
    const shifted = layerNorm(values.map(value => 1e16 + value));
    assert.equal(shifted.variance, ordinary.variance);
    assert.deepEqual(shifted.normalized, ordinary.normalized);
    close(shifted.normalized.reduce((total, value) => total + value, 0), 0);
  }
});
test('LayerNorm: epsilon means normalized variance is below one', () => {
  const { normalized, variance } = layerNorm([1, 2, 3, 4], { epsilon: .25 });
  close(normalized.reduce((s, v) => s + v * v, 0) / normalized.length, variance / (variance + .25));
  close(normalized.reduce((s, v) => s + v, 0), 0);
});
test('LayerNorm: affine gain and bias are applied after normalization', () => {
  const result = layerNorm([2, 4, 6], { gamma: -2, beta: .5 });
  result.output.forEach((v, i) => close(v, -2 * result.normalized[i] + .5));
});
test('LayerNorm: does not mutate its input', () => {
  const values = Object.freeze([1, 3, 2, 4]);
  layerNorm(values);
  assert.deepEqual(values, [1, 3, 2, 4]);
});
test('LayerNorm: invalid features, epsilon and affine parameters fail explicitly', () => {
  for (const values of [[], null, [[1]], [NaN], [Infinity], ['1']]) assert.throws(() => layerNorm(values));
  for (const epsilon of [0, -1, Infinity, NaN, '1']) assert.throws(() => layerNorm([1, 2], { epsilon }));
  assert.throws(() => layerNorm([1, 2], { gamma: Infinity }));
  assert.throws(() => layerNorm([1, 2], { beta: NaN }));
});
test('LayerNorm: unrepresentable variance is rejected rather than silently returning zeros', () => {
  assert.throws(() => layerNorm([1e308, -1e308]), RangeError);
  assert.throws(() => layerNorm([1e200, -1e200]), RangeError);
});
