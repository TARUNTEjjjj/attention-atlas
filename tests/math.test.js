import test from 'node:test';
import assert from 'node:assert/strict';
import {softmax, matmul, convolve2d, convolutionWindow, rnnSequence, attention, positionalEncoding} from '../src/math.js';

function near(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} ≈ ${expected}`);
}
function matrixNear(actual, expected, tolerance = 1e-12) {
  assert.equal(actual.length, expected.length);
  actual.forEach((row, i) => {
    assert.equal(row.length, expected[i].length);
    row.forEach((value, j) => near(value, expected[i][j], tolerance));
  });
}

test('softmax: equal logits produce a uniform distribution', () => {
  assert.deepEqual(softmax([0, 0, 0, 0]), [0.25, 0.25, 0.25, 0.25]);
});
test('softmax: known odds and invariance to an additive constant', () => {
  const expected = [1 / 6, 2 / 6, 3 / 6];
  softmax([0, Math.log(2), Math.log(3)]).forEach((x, i) => near(x, expected[i]));
  const a = softmax([-2, 0, 3]);
  softmax([998, 1000, 1003]).forEach((x, i) => near(x, a[i]));
});
test('softmax: very large logits stay finite and normalized', () => {
  const result = softmax([10000, 10001, -10000]);
  assert.ok(result.every(Number.isFinite));
  near(result.reduce((a, b) => a + b), 1);
  near(result[1], 1 / (1 + Math.exp(-1)));
});
test('softmax: masked entries are zero and all-masked rows fail explicitly', () => {
  assert.deepEqual(softmax([-Infinity, 0, -Infinity]), [0, 1, 0]);
  assert.throws(() => softmax([-Infinity, -Infinity]), /unmasked/);
});
test('softmax: invalid and empty inputs are rejected', () => {
  for (const values of [[], [NaN], [Infinity], ['0'], null]) assert.throws(() => softmax(values));
});
test('matrix multiplication: rectangular hand-computed example', () => {
  assert.deepEqual(matmul([[1, 2, 3], [4, 5, 6]], [[7, 8], [9, 10], [11, 12]]), [[58, 64], [139, 154]]);
});
test('matrix multiplication: rejects incompatible and ragged shapes', () => {
  assert.throws(() => matmul([[1, 2]], [[1, 2]]), /columns/);
  for (const matrix of [[], [[]], [[1], [2, 3]], [[NaN]], [[Infinity]]]) assert.throws(() => matmul(matrix, [[1]]));
});
test('matrix multiplication: rejects overflow rather than returning misleading infinities', () => {
  assert.throws(() => matmul([[1e308]], [[1e308]]), /numeric range/);
});
test('convolution: asymmetric kernel confirms cross-correlation, not flipped convolution', () => {
  const result = convolve2d([[1, 2, 3], [4, 5, 6], [7, 8, 9]], [[1, 2], [3, 4]]);
  assert.deepEqual(result, [[37, 47], [67, 77]]);
});
test('convolution: a rectangular input and rectangular filter have independent axes', () => {
  assert.deepEqual(convolve2d([[1, 2, 3, 4], [5, 6, 7, 8]], [[1, 0, -1]]), [[-2, -2], [-2, -2]]);
});
test('convolution: window exposes all exact products and zero padding', () => {
  assert.deepEqual(convolutionWindow([[1, 2], [3, 4]], [[1, 2], [3, 4]], 0, 0, {padding: 1}), {
    values: [[0, 0], [0, 1]], products: [[0, 0], [0, 4]], sum: 4,
  });
});
test('convolution: stride changes both the sampled window and output shape', () => {
  const input = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]];
  assert.deepEqual(convolve2d(input, [[1, 1], [1, 1]], {stride: 2}), [[14, 22], [46, 54]]);
  assert.deepEqual(convolutionWindow(input, [[1, 1], [1, 1]], 1, 0, {stride: 2}).values, [[9, 10], [13, 14]]);
});
test('convolution: output length uses floor for incomplete trailing windows', () => {
  assert.deepEqual(convolve2d([[1, 2, 3, 4, 5]], [[1, 1]], {stride: 2}), [[3, 7]]);
});
test('convolution: validates geometry and output coordinates', () => {
  for (const options of [{stride: 0}, {stride: 1.5}, {padding: -1}, {padding: 0.5}]) {
    assert.throws(() => convolve2d([[1]], [[1]], options));
  }
  assert.throws(() => convolve2d([[1]], [[1, 2]]), /fit/);
  for (const [row, col] of [[-1, 0], [0, -1], [1, 0], [0, 1], [0.5, 0]]) {
    assert.throws(() => convolutionWindow([[1]], [[1]], row, col));
  }
});
test('convolution: input and kernel remain unchanged', () => {
  const input = Object.freeze([Object.freeze([1, 2]), Object.freeze([3, 4])]);
  const kernel = Object.freeze([Object.freeze([2])]);
  assert.deepEqual(convolve2d(input, kernel), [[2, 4], [6, 8]]);
});
test('RNN: exposes the recurrence one arithmetic step at a time', () => {
  const steps = rnnSequence([2, -1], {wx: 0.5, wh: 0.25, bias: -0.1, h0: 0.4});
  near(steps[0].preactivation, 1);
  near(steps[0].hidden, Math.tanh(1));
  near(steps[1].previous, Math.tanh(1));
  near(steps[1].preactivation, -0.6 + 0.25 * Math.tanh(1));
  near(steps[1].hidden, Math.tanh(-0.6 + 0.25 * Math.tanh(1)));
});
test('RNN: initial-state gradient agrees with a central finite difference', () => {
  const inputs = [0.4, -0.3, 0.7, 0.1];
  const options = {wx: 0.6, wh: -1.1, bias: 0.2, h0: 0.35};
  const epsilon = 1e-6;
  const plus = rnnSequence(inputs, {...options, h0: options.h0 + epsilon});
  const minus = rnnSequence(inputs, {...options, h0: options.h0 - epsilon});
  rnnSequence(inputs, options).forEach((step, i) => {
    near(step.gradientToInitial, (plus[i].hidden - minus[i].hidden) / (2 * epsilon), 1e-9);
  });
});
test('RNN: derivatives can vanish or grow even with a bounded hidden state', () => {
  const inputs = Array(8).fill(0);
  near(rnnSequence(inputs, {wh: 0.5}).at(-1).gradientToInitial, 1 / 256);
  near(rnnSequence(inputs, {wh: 2}).at(-1).gradientToInitial, 256);
  assert.equal(rnnSequence(inputs, {wh: 2}).at(-1).hidden, 0);
});
test('RNN: tanh saturation can shrink gradients even when recurrent weight exceeds one', () => {
  const step = rnnSequence([20], {wx: 1, wh: 2})[0];
  assert.ok(Math.abs(step.localDerivative) < 1e-12);
});
test('RNN: zero recurrent weight removes dependence on the preceding state', () => {
  const a = rnnSequence([1, -1], {wh: 0, h0: 100});
  const b = rnnSequence([1, -1], {wh: 0, h0: -100});
  assert.deepEqual(a.map(x => x.hidden), b.map(x => x.hidden));
  assert.ok(a.every(x => x.gradientToInitial === 0));
});
test('RNN: empty sequences are valid and malformed values are rejected', () => {
  assert.deepEqual(rnnSequence([]), []);
  assert.throws(() => rnnSequence([NaN]));
  assert.throws(() => rnnSequence([1], {wh: Infinity}));
  assert.throws(() => rnnSequence('123'));
});
test('attention: zero queries mix all value rows uniformly', () => {
  const result = attention([[0, 0]], [[1, 2], [3, 4]], [[2, 6], [8, 10]]);
  assert.deepEqual(result.scores, [[0, 0]]);
  assert.deepEqual(result.weights, [[0.5, 0.5]]);
  assert.deepEqual(result.output, [[5, 8]]);
});
test('attention: the exact scaled dot product and weighted sum match hand arithmetic', () => {
  const result = attention([[1, 0]], [[1, 0], [0, 1]], [[2], [10]]);
  const a = Math.exp(1 / Math.sqrt(2)) / (Math.exp(1 / Math.sqrt(2)) + 1);
  matrixNear(result.scores, [[1 / Math.sqrt(2), 0]]);
  matrixNear(result.weights, [[a, 1 - a]]);
  near(result.output[0][0], 2 * a + 10 * (1 - a));
});
test('attention: every probability row sums to one and output is a convex combination', () => {
  const result = attention([[3, -1], [-2, 4], [0, 0]], [[1, 0], [1, 2], [2, 1]], [[-5, 3], [9, 1], [4, 7]]);
  result.weights.forEach(row => {
    near(row.reduce((a, b) => a + b), 1);
    assert.ok(row.every(x => x >= 0 && x <= 1));
  });
  result.output.forEach(([x, y]) => {
    assert.ok(x >= -5 && x <= 9);
    assert.ok(y >= 1 && y <= 7);
  });
});
test('attention: causal mask is lower triangular and forbids future-value leakage', () => {
  const Q = [[1], [1], [1]], K = [[0], [0], [0]];
  const a = attention(Q, K, [[1], [2], [3]], {causal: true});
  const b = attention(Q, K, [[1], [2], [999]], {causal: true});
  assert.deepEqual(a.scores, [[0, -Infinity, -Infinity], [0, 0, -Infinity], [0, 0, 0]]);
  assert.deepEqual(a.weights, [[1, 0, 0], [0.5, 0.5, 0], [1 / 3, 1 / 3, 1 / 3]]);
  assert.deepEqual(a.output, [[1], [1.5], [2]]);
  assert.deepEqual(a.output.slice(0, 2), b.output.slice(0, 2));
});
test('attention: a masked future key cannot affect earlier output', () => {
  const a = attention([[1], [1]], [[1], [2]], [[3], [4]], {causal: true});
  const b = attention([[1], [1]], [[1], [-999]], [[3], [4]], {causal: true});
  assert.deepEqual(a.output[0], b.output[0]);
});
test('attention: temperature softens or sharpens scores and optional scaling is exact', () => {
  const Q = [[2, 0]], K = [[1, 0], [0, 1]], V = [[1], [0]];
  const unscaled = attention(Q, K, V, {scale: false});
  assert.deepEqual(unscaled.scores, [[2, 0]]);
  assert.ok(attention(Q, K, V, {temperature: 0.5}).weights[0][0] > attention(Q, K, V, {temperature: 2}).weights[0][0]);
});
test('attention: supports different query counts and value feature dimensions', () => {
  const result = attention([[1, 2], [0, 0]], [[1, 0], [0, 1], [1, 1]], [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]);
  assert.equal(result.weights.length, 2);
  assert.equal(result.weights[0].length, 3);
  assert.equal(result.output.length, 2);
  assert.equal(result.output[0].length, 4);
  matrixNear([result.output[1]], [[5, 6, 7, 8]]);
});
test('attention: rejects incompatible shapes and invalid temperatures', () => {
  assert.throws(() => attention([[1, 2]], [[1]], [[1]]), /feature dimension/);
  assert.throws(() => attention([[1]], [[1], [2]], [[1]]), /number of rows/);
  for (const temperature of [0, -1, NaN, Infinity]) assert.throws(() => attention([[1]], [[1]], [[1]], {temperature}));
  assert.throws(() => attention([[1]], [[1]], [[1]], {causal: 'yes'}));
  assert.throws(() => attention([[1]], [[1]], [[1]], {scale: 1}));
});
test('attention: overflow is rejected rather than silently producing uniform probabilities', () => {
  assert.throws(() => attention([[1, 2]], [[1, 2]], [[1]], {temperature: Number.MAX_VALUE}), /numeric range/);
  assert.throws(() => attention([[1e308]], [[1e308]], [[1]]), /numeric range/);
});
test('position encoding: zero position alternates sine-zero and cosine-one', () => {
  assert.deepEqual(positionalEncoding(0), [0, 1, 0, 1, 0, 1, 0, 1]);
});
test('position encoding: known paired frequencies match the paper equation', () => {
  const result = positionalEncoding(2, 4);
  [Math.sin(2), Math.cos(2), Math.sin(0.02), Math.cos(0.02)].forEach((x, i) => near(result[i], x));
  near(result[0] ** 2 + result[1] ** 2, 1);
  near(result[2] ** 2 + result[3] ** 2, 1);
});
test('position encoding: supports an odd dimension and validates discrete positions', () => {
  assert.equal(positionalEncoding(3, 5).length, 5);
  assert.deepEqual(positionalEncoding(0, 1), [0]);
  for (const [position, dimensions] of [[-1, 8], [0.5, 8], [NaN, 8], [0, 0], [0, 2.5]]) {
    assert.throws(() => positionalEncoding(position, dimensions));
  }
});
