import { softmax } from './math.js';

/** Small arithmetic helpers: no attention matrices or model weights are allocated. */
const finite = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
};
const boundedInteger = (value, name, minimum, maximum) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
};

/** mulberry32: a tiny deterministic generator, so every learner sees the same sample. Not for security. */
function seededUniform(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller transform: two independent uniforms become two independent standard normals. */
function seededNormal(seed) {
  const uniform = seededUniform(seed);
  let spare = null;
  return () => {
    if (spare !== null) { const value = spare; spare = null; return value; }
    const radius = Math.sqrt(-2 * Math.log(1 - uniform()));
    const angle = 2 * Math.PI * uniform();
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}

/**
 * Sample q · k for query and key vectors whose components are independent, mean 0 and variance 1:
 * the assumption in footnote 4 of Vaswani et al. (2017), under which Var(q · k) = dₖ exactly.
 * Dividing by √dₖ restores variance 1. Reported variances are unbiased sample estimates.
 */
export function dotProductSpread({ dimensions, samples = 2000, seed = 2017 }) {
  boundedInteger(dimensions, 'dimensions', 1, 4096);
  boundedInteger(samples, 'samples', 2, 20000);
  boundedInteger(seed, 'seed', 0, 4294967295);
  const normal = seededNormal(seed);
  const dots = new Float64Array(samples);
  for (let s = 0; s < samples; s++) {
    let dot = 0;
    for (let i = 0; i < dimensions; i++) dot += normal() * normal();
    dots[s] = dot;
  }
  let mean = 0;
  for (const dot of dots) mean += dot / samples;
  let squared = 0, maxAbs = 0;
  for (const dot of dots) { squared += (dot - mean) ** 2; maxAbs = Math.max(maxAbs, Math.abs(dot)); }
  const variance = squared / (samples - 1), scale = Math.sqrt(dimensions);
  return { dimensions, samples, seed, theoryVariance: dimensions, theoryStd: scale, mean, variance, std: Math.sqrt(variance), scaledMean: mean / scale, scaledVariance: variance / dimensions, scaledStd: Math.sqrt(variance) / scale, maxAbs, scaledMaxAbs: maxAbs / scale };
}

/**
 * One key scores one theoretical standard deviation (√dₖ) above every other key.
 * Compares softmax before and after division by √dₖ. slope = ∂p/∂s for the top key = p(1 − p).
 */
export function softmaxSaturation(dimensions, otherKeys = 3) {
  boundedInteger(dimensions, 'dimensions', 1, 4096);
  boundedInteger(otherKeys, 'otherKeys', 1, 63);
  const gap = Math.sqrt(dimensions);
  const describe = top => {
    const scores = [top, ...Array(otherKeys).fill(0)];
    const weights = softmax(scores);
    return { scores, weights, slope: weights[0] * (1 - weights[0]) };
  };
  return { dimensions, gap, unscaled: describe(gap), scaled: describe(gap / Math.sqrt(dimensions)) };
}

/** Memory of one dense score tensor for a single sequence, across all heads. */
export function scoreBudget({ tokens, heads, bytesPerElement }) {
  for (const [name, value] of Object.entries({ tokens, heads, bytesPerElement })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer.`);
  }
  const elementsPerHead = tokens * tokens;
  const elements = elementsPerHead * heads;
  const bytes = elements * bytesPerElement;
  if (![elementsPerHead, elements, bytes].every(Number.isSafeInteger)) throw new RangeError('The requested budget exceeds exact integer arithmetic.');
  return { tokens, heads, bytesPerElement, elementsPerHead, elements, bytes, mebibytes: bytes / 2 ** 20, gibibytes: bytes / 2 ** 30 };
}

function sum(values) {
  // Compensated summation keeps the small centred differences visible.
  let total = 0, correction = 0;
  for (const value of values) {
    const adjusted = value - correction;
    const next = total + adjusted;
    correction = (next - total) - adjusted;
    total = next;
  }
  return total;
}

/** Population-variance LayerNorm over one feature vector. gamma/beta are scalar here. */
export function layerNorm(values, { epsilon = 1e-5, gamma = 1, beta = 0 } = {}) {
  if (!Array.isArray(values) || values.length === 0) throw new TypeError('LayerNorm needs a nonempty feature vector.');
  values.forEach(value => finite(value, 'Feature'));
  for (const [name, value] of Object.entries({ epsilon, gamma, beta })) finite(value, name);
  if (epsilon <= 0) throw new RangeError('epsilon must be positive.');
  // Compute around a reference rather than subtracting two large squared sums.
  const reference = values[0];
  const differences = values.map(value => value - reference);
  if (differences.some(value => !Number.isFinite(value))) throw new RangeError('Feature differences exceed the numeric range.');
  const meanDifference = sum(differences.map(value => value / values.length));
  const mean = reference + meanDifference;
  // Keep centering in the reference frame. Adding a large reference can round
  // the mean before subtraction, inventing variance and a nonzero output mean.
  const centered = differences.map(value => value - meanDifference);
  const variance = sum(centered.map(value => (value / values.length) * value));
  const denominator = Math.sqrt(variance + epsilon);
  if (![mean, variance, denominator].every(Number.isFinite) || denominator <= 0) throw new RangeError('LayerNorm exceeded the finite numeric range.');
  const normalized = centered.map(value => value / denominator);
  const output = normalized.map(value => gamma * value + beta);
  if (output.some(value => !Number.isFinite(value))) throw new RangeError('Affine output exceeded the finite numeric range.');
  return { mean, variance, normalized, output };
}
