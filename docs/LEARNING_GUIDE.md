# Attention Atlas: a mathematical learning guide

The website is a collection of small, exact forward computations. Its matrices and labels are illustrative; it does not run a trained language model or image classifier. This guide adds hand calculations you can compare with the labs.

## 1. Follow shapes before numbers

A matrix product `(a × b)(b × c)` has shape `a × c`. The inner dimensions must match. Keep a table of each intermediate shape whenever a formula feels abstract.

For a linear layer with column-vector input, `z = Wx + b` uses `W` of shape `output × input`. Row-vector conventions transpose this arrangement. Both are valid; mixing conventions without transposing is not.

Nonlinearities matter. Composing only affine maps still gives an affine map. ReLU, tanh, and softmax change that restriction in different ways.

## 2. CNN: calculate one patch

Use this input patch and filter:

```text
X = [1 0 0]      K = [1 0 -1]
    [1 0 0]          [1 0 -1]
    [1 0 0]          [1 0 -1]
```

The cross-correlation response is `1 + 1 + 1 = 3`. Shift the nonzero column from the left to the right and the response becomes `−3`. Fill the whole patch with ones and the response becomes zero. These are different patterns even if a later ReLU discards all negative responses.

For dilation 1, the number of valid window starts along one axis is:

```text
floor((input + 2 × padding − kernel) / stride) + 1
```

A 5-wide input with kernel 3, stride 2, and no padding has two starts: 0 and 2. A partly overlapping start at 4 is invalid because the full window would not fit.

Parameter sharing means one filter is reused at every valid start. With 2 input channels, 4 output channels and a 3 × 3 kernel, there are `4 × 2 × 3 × 3 = 72` weights, plus 4 biases if enabled. The output map's width does not change this parameter count.

For a stack, track receptive-field width `r` and spacing `j` between adjacent output centres in input coordinates. Start with `r = 1`, `j = 1`. A layer of kernel width `k`, dilation `d`, and stride `s` updates:

```text
r_new = r + (k − 1) × d × j
j_new = j × s
```

This describes the potential receptive field, not how strongly each pixel influences a trained prediction.

## 3. RNN: separate state from sensitivity

For `h_t = tanh(w_x x_t + w_h h_(t−1) + b)`, hold the inputs and weights fixed while differentiating with respect to the previous state:

```text
∂h_t / ∂h_(t−1) = w_h × (1 − h_t²)
```

With all inputs and bias zero, initial state zero, and `w_h = 0.5`, every state is zero. Nevertheless, a small perturbation to the initial state propagates with derivative `0.5^T`. At six steps the derivative is `1/64 = 0.015625`.

At the same zero-state trajectory with `w_h = 1.2`, the six-step derivative is `1.2^6 = 2.985984`. This is local sensitivity: tanh still bounds every actual hidden-state value between −1 and 1. A growing derivative does not imply unbounded hidden values.

A strong nonzero input can push tanh into saturation and make `1 − h_t²` small. Therefore, inspecting only the recurrent weight is insufficient. For vector states, these factors become Jacobian matrices; their product depends on directions as well as magnitudes.

The lab's `gradientToInitial` is `∂h_t/∂h_0`, not a loss gradient. A training loss introduces additional derivatives and contributions. Backpropagation through time adds all paths by which a shared parameter influences the loss.

## 4. Attention: normalise, then mix

Start with two scores, `s = [0, ln(3)]`. Exponentiation gives `[1, 3]`, so softmax gives `[1/4, 3/4]`. If the scalar values are `[2, 10]`, the output is `8`.

The same probabilities result from scores `[1000, 1000 + ln(3)]`. Direct exponentiation could overflow, so subtract the maximum score first. This common subtraction cancels between numerator and denominator and preserves the result.

Let `Q` have shape `n × d_k`, `K` have shape `m × d_k`, and `V` have shape `m × d_v`:

```text
Q Kᵀ                  n × m
softmax of each row   n × m
weights × V           n × d_v
```

Every allowed attention row is a probability distribution. Each output is a convex combination of value vectors. Consequently, every output coordinate is between the smallest and largest allowed values in that coordinate. This guarantee applies to the weighted average before subsequent projections or residual additions.

A causal mask must remove future keys before normalisation. For query index zero in a same-length causal self-attention sequence, only key index zero is allowed: its weight is exactly one. Setting future scores to zero would fail, because `exp(0)` is positive.

Try making all allowed scores equal. The output is then their values' arithmetic mean. Now keep scores fixed and change a value: the weights do not move, but the output does. This demonstrates why keys and values have different jobs.

## 5. Position and architecture: ask what the function can distinguish

Consider an unmasked self-attention function with no positional signals. Let `P` be a permutation matrix that reorders the input rows. Reordering all rows transforms the score matrix from `S` to `P S Pᵀ`. Row-wise softmax preserves that rearrangement, and multiplying by reordered values gives `P` times the original output. The operation is permutation-equivariant: it follows the row shuffle rather than identifying a privileged first position.

Position signals or an order-sensitive mask change the information available to the function. Inspect the position lab at index zero: every sine component is zero and every cosine component is one. This follows immediately from `sin(0) = 0` and `cos(0) = 1`; it is not a learned property.

A residual sum needs matching shapes. If `x` has width `d`, the sublayer added to it must also produce width `d`, even if intermediate computations expand or split that width. A feed-forward expansion can transform `d` features to a wider space and then map back.

Multiple attention heads use distinct projections, giving different coordinate systems for matching and mixing. Their outputs are concatenated and mapped back to model width. It is not correct to treat heads as guaranteed grammatical roles: any interpretation must be tested on a trained model.

For historical architecture details, use the website's compact 2017 architecture section and read the primary paper. Do not assume that the original encoder–decoder, decoder-only models, and every later architecture have identical normalisation, positions, or training procedures.

## 6. A self-check routine

1. Write down input and output shapes.
2. Predict one numerical result before moving a slider.
3. Reproduce it by hand.
4. Change only one input or parameter.
5. Explain which intermediate quantity changed first.
6. State one limitation of the demonstration.

Examples of honest limitations: a scalar RNN is not a language model; one filter does not classify an image; an attention heatmap is not a causal explanation; a small forward-pass lab does not benchmark training speed.

## Primary references

- [Vaswani et al., Attention Is All You Need (2017)](https://arxiv.org/abs/1706.03762): original architecture and attention equations.
- [PyTorch Conv2d](https://docs.pytorch.org/docs/stable/generated/torch.nn.Conv2d.html): cross-correlation convention and layer shapes.
- [PyTorch RNN](https://docs.pytorch.org/docs/stable/generated/torch.nn.RNN.html): practical vector recurrence.
- [Jain & Wallace, Attention is not Explanation (2019)](https://aclanthology.org/N19-1357/): evidence against interpreting attention weights alone as explanations.

All examples and teaching prose in this guide are original. No paper figures are reproduced.
