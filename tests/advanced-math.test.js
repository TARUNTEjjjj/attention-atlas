import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreBudget, layerNorm } from '../src/advanced-math.js';
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

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
