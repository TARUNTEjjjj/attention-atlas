/** Small arithmetic helpers: no attention matrices or model weights are allocated. */
const finite = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
};

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
  const mean = reference + sum(differences.map(value => value / values.length));
  const centered = values.map(value => value - mean);
  const variance = sum(centered.map(value => (value / values.length) * value));
  const denominator = Math.sqrt(variance + epsilon);
  if (![mean, variance, denominator].every(Number.isFinite) || denominator <= 0) throw new RangeError('LayerNorm exceeded the finite numeric range.');
  const normalized = centered.map(value => value / denominator);
  const output = normalized.map(value => gamma * value + beta);
  if (output.some(value => !Number.isFinite(value))) throw new RangeError('Affine output exceeded the finite numeric range.');
  return { mean, variance, normalized, output };
}
