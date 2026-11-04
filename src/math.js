/**
 * Small, inspectable numerical models for the learning labs.
 * These routines evaluate supplied numbers; they do not train a neural network.
 */

function finiteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
}

function integer(value, name, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be an integer greater than or equal to ${minimum}.`);
  }
}

function matrixShape(matrix, name) {
  if (!Array.isArray(matrix) || matrix.length === 0 || !Array.isArray(matrix[0]) || matrix[0].length === 0) {
    throw new TypeError(`${name} must be a nonempty rectangular matrix.`);
  }
  const width = matrix[0].length;
  for (const row of matrix) {
    if (!Array.isArray(row) || row.length !== width) {
      throw new TypeError(`${name} must be a nonempty rectangular matrix.`);
    }
    for (const value of row) finiteNumber(value, `${name} entry`);
  }
  return [matrix.length, width];
}

function checkedResult(value, operation) {
  if (!Number.isFinite(value)) throw new RangeError(`${operation} exceeded the finite numeric range.`);
  return value;
}

/** Row-wise softmax. -Infinity denotes a masked entry, which receives exactly 0. */
export function softmax(values) {
  if (!Array.isArray(values) || values.length === 0) throw new TypeError('Softmax requires a nonempty array.');
  let maximum = -Infinity;
  for (const value of values) {
    if (typeof value !== 'number' || Number.isNaN(value) || value === Infinity) {
      throw new TypeError('Softmax entries must be finite numbers or -Infinity masks.');
    }
    if (value > maximum) maximum = value;
  }
  if (maximum === -Infinity) throw new RangeError('Softmax needs at least one unmasked entry.');
  // Subtracting the maximum changes neither the ratios nor the result, and
  // prevents exp(large positive logits) from overflowing.
  const exponentials = values.map(value => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map(value => value / total);
}

/** Standard matrix multiplication. */
export function matmul(A, B) {
  const [rows, inner] = matrixShape(A, 'A');
  const [otherInner, columns] = matrixShape(B, 'B');
  if (inner !== otherInner) throw new RangeError('Matrix multiplication requires A columns to equal B rows.');
  return Array.from({length: rows}, (_, i) => Array.from({length: columns}, (_, j) => {
    let value = 0;
    for (let k = 0; k < inner; k++) value += A[i][k] * B[k][j];
    return checkedResult(value, 'Matrix multiplication');
  }));
}

function convolutionGeometry(input, kernel, stride, padding) {
  const [height, width] = matrixShape(input, 'Input');
  const [kernelHeight, kernelWidth] = matrixShape(kernel, 'Kernel');
  integer(stride, 'Stride', 1);
  integer(padding, 'Padding', 0);
  const rows = Math.floor((height + 2 * padding - kernelHeight) / stride) + 1;
  const columns = Math.floor((width + 2 * padding - kernelWidth) / stride) + 1;
  if (rows < 1 || columns < 1) throw new RangeError('Kernel must fit within the padded input.');
  return {height, width, kernelHeight, kernelWidth, rows, columns};
}

function windowAt(input, kernel, row, col, stride, padding, geometry) {
  const {height, width, kernelHeight, kernelWidth} = geometry;
  const values = Array.from({length: kernelHeight}, (_, i) => Array.from({length: kernelWidth}, (_, j) => {
    const inputRow = row * stride + i - padding;
    const inputCol = col * stride + j - padding;
    return inputRow < 0 || inputCol < 0 || inputRow >= height || inputCol >= width ? 0 : input[inputRow][inputCol];
  }));
  const products = values.map((line, i) => line.map((value, j) => checkedResult(value * kernel[i][j], 'Convolution')));
  const sum = checkedResult(products.reduce((total, line) => total + line.reduce((a, b) => a + b, 0), 0), 'Convolution');
  return {values, products, sum};
}

/**
 * Inspect the input window for an OUTPUT coordinate (row, col).
 * Padding is zero padding. The kernel is not reversed: this is cross-correlation,
 * the operation conventionally called convolution in CNN libraries.
 */
export function convolutionWindow(input, kernel, row, col, {stride = 1, padding = 0} = {}) {
  const geometry = convolutionGeometry(input, kernel, stride, padding);
  integer(row, 'Output row', 0);
  integer(col, 'Output column', 0);
  if (row >= geometry.rows || col >= geometry.columns) throw new RangeError('Output coordinate is outside the convolution result.');
  return windowAt(input, kernel, row, col, stride, padding, geometry);
}

/** One input channel, one filter, no bias or activation. */
export function convolve2d(input, kernel, {stride = 1, padding = 0} = {}) {
  const geometry = convolutionGeometry(input, kernel, stride, padding);
  return Array.from({length: geometry.rows}, (_, row) => Array.from({length: geometry.columns}, (_, col) =>
    windowAt(input, kernel, row, col, stride, padding, geometry).sum));
}

/**
 * A scalar tanh RNN: h[t] = tanh(wx*x[t] + wh*h[t-1] + bias).
 * localDerivative = dh[t]/dh[t-1]; gradientToInitial = dh[t]/dh[0].
 * Here h0 names the initial state, before the first input is consumed.
 */
export function rnnSequence(inputs, {wx = 0.8, wh = 0.7, bias = 0, h0 = 0} = {}) {
  if (!Array.isArray(inputs)) throw new TypeError('Inputs must be an array.');
  for (const input of inputs) finiteNumber(input, 'RNN input');
  for (const [name, value] of Object.entries({wx, wh, bias, h0})) finiteNumber(value, name);
  let previous = h0;
  let gradient = 1;
  return inputs.map(input => {
    const preactivation = checkedResult(wx * input + wh * previous + bias, 'RNN preactivation');
    const hidden = Math.tanh(preactivation);
    const localDerivative = wh * (1 - hidden * hidden);
    gradient = checkedResult(gradient * localDerivative, 'RNN gradient');
    const step = {input, previous, preactivation, hidden, localDerivative, gradientToInitial: gradient};
    previous = hidden;
    return step;
  });
}

/**
 * Scaled dot-product attention, with optional lower-triangular causal masking.
 * Q: queries × dk, K: keys × dk, V: keys × dv. Softmax is over keys.
 * Temperature is an exploratory control, not an extra term in the original
 * paper's equation; temperature=1 reproduces that equation.
 */
export function attention(Q, K, V, {causal = false, scale = true, temperature = 1} = {}) {
  const [queryCount, dk] = matrixShape(Q, 'Q');
  const [keyCount, keyDimensions] = matrixShape(K, 'K');
  const [valueCount] = matrixShape(V, 'V');
  if (dk !== keyDimensions) throw new RangeError('Q and K must have the same feature dimension.');
  if (keyCount !== valueCount) throw new RangeError('K and V must have the same number of rows.');
  if (typeof causal !== 'boolean' || typeof scale !== 'boolean') throw new TypeError('Causal and scale options must be booleans.');
  finiteNumber(temperature, 'Temperature');
  if (temperature <= 0) throw new RangeError('Temperature must be greater than zero.');
  const divisor = checkedResult((scale ? Math.sqrt(dk) : 1) * temperature, 'Attention divisor');
  const scores = Array.from({length: queryCount}, (_, i) => Array.from({length: keyCount}, (_, j) => {
    if (causal && j > i) return -Infinity;
    let dot = 0;
    for (let k = 0; k < dk; k++) dot += Q[i][k] * K[j][k];
    return checkedResult(dot / divisor, 'Attention score');
  }));
  const weights = scores.map(softmax);
  return {scores, weights, output: matmul(weights, V)};
}

/** Sinusoidal position vector from the original Transformer, zero-based. */
export function positionalEncoding(position, dimensions = 8) {
  integer(position, 'Position', 0);
  integer(dimensions, 'Dimensions', 1);
  return Array.from({length: dimensions}, (_, index) => {
    const angle = position / (10000 ** (2 * Math.floor(index / 2) / dimensions));
    return index % 2 === 0 ? Math.sin(angle) : Math.cos(angle);
  });
}
