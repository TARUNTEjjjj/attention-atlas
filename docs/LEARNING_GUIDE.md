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

Convolution at stride 1 is translation-equivariant: shifting the input shifts the feature map. Clear the lab image and light only the centre pixel (row 3, column 3). With the vertical-edge filter, stride 1 and padding 1, rows 2–4 of the 5 × 5 map are `[0, 1, 0, −1, 0]`. Move the pixel one column right and those rows become `[0, 0, 1, 0, −1]`: the same pattern, one cell to the right. At stride 2 the centre pixel produces an all-zero 3 × 3 map, because the only window containing it places the pixel on the filter's zero middle column. One column to the right, the middle row becomes `[0, 1, −1]`. An odd shift changed the pattern instead of moving it. A two-column shift does move it by one output cell: a pixel in column 2 gives the middle row `[1, −1, 0]`, and a pixel in column 4 gives `[0, 1, −1]`.

A 1 × 1 convolution mixes the channel values at each position with weights shared across positions, and never mixes neighbouring positions. The Transformer paper notes that its position-wise feed-forward network can be described as two convolutions with kernel size 1.

## 3. RNN: separate state from sensitivity

For `h_t = tanh(w_x x_t + w_h h_(t−1) + b)`, hold the inputs and weights fixed while differentiating with respect to the previous state:

```text
∂h_t / ∂h_(t−1) = w_h × (1 − h_t²)
```

With all inputs and bias zero, initial state zero, and `w_h = 0.5`, every state is zero. Nevertheless, a small perturbation to the initial state propagates with derivative `0.5^T`. At six steps the derivative is `1/64 = 0.015625`.

At the same zero-state trajectory with `w_h = 1.2`, the six-step derivative is `1.2^6 = 2.985984`. This is local sensitivity: tanh still bounds every actual hidden-state value between −1 and 1. A growing derivative does not imply unbounded hidden values.

A strong nonzero input can push tanh into saturation and make `1 − h_t²` small. Therefore, inspecting only the recurrent weight is insufficient. For vector states, these factors become Jacobian matrices; their product depends on directions as well as magnitudes.

The lab's `gradientToInitial` is `∂h_t/∂h_0`, not a loss gradient. A training loss introduces additional derivatives and contributions. Backpropagation through time adds all paths by which a shared parameter influences the loss.

A larger recurrent weight can produce a smaller sensitivity. With the lab's default inputs `[1, 0.5, −1, 0.8]` and `w_x = 0.8`, the four-step derivative is about `0.172` at `w_h = 1.2` but about `0.018` at `w_h = 2.0`. The states become roughly `[0.664, 0.939, 0.792, 0.977]`: `h₁ = tanh(0.8)` is the same in both runs, but `h₂` to `h₄` move closer to ±1, where `1 − h²` is small.

An LSTM adds a cell state `c_t = f_t ⊙ c_(t−1) + i_t ⊙ g_t` (see the [PyTorch LSTM equations](https://docs.pytorch.org/docs/stable/generated/torch.nn.LSTM.html)). Holding the gates fixed, the direct path gives `∂c_t/∂c_(t−1) = f_t`, element by element. The gates depend on `h_(t−1)`, so other paths remain. For exploding gradients, [Pascanu, Mikolov and Bengio (2013)](https://arxiv.org/abs/1211.5063) proposed gradient norm clipping: when the gradient's norm reaches a threshold, rescale the gradient to that norm.

The RNN chapter ends where attention began. RNN encoder–decoders compressed a source sentence into one fixed-length vector. [Bahdanau, Cho and Bengio (2014)](https://arxiv.org/abs/1409.0473) conjectured that this vector was a bottleneck, and let the decoder perform a soft search over all encoder states at each output step. The Transformer kept attention and removed recurrence.

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

**Why divide by `√d_k`.** Footnote 4 of the paper assumes that the components of `q` and `k` are independent, with mean 0 and variance 1. Then each product `q_i k_i` has variance 1, and `q · k` has variance `d_k`. At `d_k = 64` the standard deviation is 8. Give one key a score one standard deviation above three others:

```text
scores [8, 0, 0, 0]  → weights ≈ [0.9990, 0.0003, 0.0003, 0.0003]   slope p(1 − p) ≈ 0.0010
scores [1, 0, 0, 0]  → weights ≈ [0.4754, 0.1749, 0.1749, 0.1749]   slope p(1 − p) ≈ 0.2494
```

The second row is the first divided by `√64 = 8`. Here `p(1 − p)` is the derivative of the top weight with respect to its own score. The authors suspected that unscaled dot products push softmax into regions with extremely small gradients; the paper also cites earlier results in which additive attention outperformed unscaled dot products at larger `d_k`. Experiment 04 repeats the calculation for `d_k` from 1 to 512, with a fixed-seed sample of 2,000 random pairs to show the variance growing.

**Multiple heads.** The base model uses `h = 8` heads with `d_k = d_v = 512 / 8 = 64`. Each head attends using its own learned projections; the eight 64-wide outputs are concatenated back to 512 coordinates and multiplied by `Wᴼ`. The paper states that the total cost is similar to one full-width head. In Table 3 rows (A), one head scored 0.9 BLEU below the best setting on the development set, and quality also fell with too many heads.

## 5. Position and architecture: ask what the function can distinguish

Consider an unmasked self-attention function with no positional signals. Let `P` be a permutation matrix that reorders the input rows. Reordering all rows transforms the score matrix from `S` to `P S Pᵀ`. Row-wise softmax preserves that rearrangement, and multiplying by reordered values gives `P` times the original output. The operation is permutation-equivariant: it follows the row shuffle rather than identifying a privileged first position.

Position signals or an order-sensitive mask change the information available to the function. Inspect the position lab at index zero: every sine component is zero and every cosine component is one. This follows immediately from `sin(0) = 0` and `cos(0) = 1`; it is not a learned property.

Each sine/cosine pair `i` turns at frequency `ω = 1 / 10000^(2i/d)`. With `d = 8` the wavelengths are `2π, 20π, 200π` and `2000π` positions. The angle-addition rules give, for any offset `k`,

```text
[sin(ω(p + k)), cos(ω(p + k))] = [[cos kω,  sin kω],
                                  [−sin kω, cos kω]] · [sin ωp, cos ωp]
```

At `p = 4` and pair 0 (`ω = 1`), rotating `[−0.7568, −0.6536]` by one radian gives `[−0.9589, 0.2837]`, the pair at `p = 5`. The matrix depends on `k` and `ω`, not on `p`. The paper chose sinusoids because the authors hypothesised that this linear relation would make relative positions easy to learn. Learned position embeddings gave nearly identical results (Table 3, row E); the paper kept sinusoids because they may let the model extrapolate to sequences longer than those seen in training. [Rotary position embedding](https://arxiv.org/abs/2104.09864) reuses these frequencies but rotates queries and keys instead of adding a vector, so position enters each score only through the offset between query and key.

A residual sum needs matching shapes. If `x` has width `d`, the sublayer added to it must also produce width `d`, even if intermediate computations expand or split that width. A feed-forward expansion can transform `d` features to a wider space and then map back.

Multiple attention heads use distinct projections, giving different coordinate systems for matching and mixing. Their outputs are concatenated and mapped back to model width. It is not correct to treat heads as guaranteed grammatical roles: any interpretation must be tested on a trained model.

For historical architecture details, use the website's compact 2017 architecture section and read the primary paper. Do not assume that the original encoder–decoder, decoder-only models, and every later architecture have identical normalisation, positions, or training procedures.

**Compare the three ways to connect.** Section 4 and Table 1 of the paper compare single layers over `n` positions of width `d` (kernel width `k`, neighbourhood size `r`):

| Layer | Work per layer | Sequential steps | Longest path |
| --- | --- | --- | --- |
| Self-attention | `O(n² · d)` | `O(1)` | `O(1)` |
| Recurrent | `O(n · d²)` | `O(n)` | `O(n)` |
| Convolutional | `O(k · n · d²)` | `O(1)` | `O(log_k n)` |
| Self-attention over `r` neighbours | `O(r · n · d)` | `O(1)` | `O(n / r)` |

The convolutional path assumes dilated convolutions; contiguous kernels need `O(n / k)` stacked layers. In this accounting, self-attention does less work than recurrence when `n < d`: at `n = 50`, `d = 512`, `n²d = 1,280,000` and `nd² = 13,107,200`. At `n = 4,096` the order reverses, with `n²d` eight times `nd²`. The `O(n² · d)` entry covers the scores and the weighted sum; the query, key, value and output projections add `O(n · d²)`, the same order as a recurrent layer (at `n = 50`, `4nd² = 52,428,800`). These are growth rates, not measured timings.

## 6. Train and count the 2017 model

The base model used Adam with `β₁ = 0.9`, `β₂ = 0.98` and `ε = 10⁻⁹`, and this learning-rate schedule:

```text
lrate = d_model^−0.5 · min(step^−0.5, step · warmup_steps^−1.5),   warmup_steps = 4000
```

Both terms equal `4000^−0.5` at step 4,000, so the peak is `512^−0.5 × 4000^−0.5 = 1 / √2,048,000 ≈ 6.99 × 10⁻⁴`. After the peak, quadrupling the step halves the rate: step 16,000 gives about `3.49 × 10⁻⁴`. Training also used dropout 0.1 on each sub-layer output before its residual addition and on the embedding sums, and label smoothing 0.1. The base model trained for 100,000 steps, about 12 hours on 8 P100 GPUs, and scored 27.3 BLEU on English-to-German newstest2014; the big model scored 28.4. [Xiong et al. (2020)](https://arxiv.org/abs/2002.04745) relate the need for warm-up to the post-normalization layout and report that pre-normalization Transformers trained without warm-up reach comparable results.

Count one encoder layer from the paper's equations, which show no attention biases:

```text
attention   8 heads × 3 × (512 × 64) + 512 × 512           = 1,048,576
FFN         512 × 2048 + 2048 + 2048 × 512 + 512            = 2,099,712
LayerNorm   2 × (512 gains + 512 biases)                    =     2,048
encoder layer                                               = 3,150,336
```

The feed-forward network holds about two-thirds of the layer. A decoder layer adds one attention block and one LayerNorm: 4,199,936. Table 3 reports about 65 million parameters for the base model; the shared embedding matrix (about 37,000 tokens × 512) supplies much of the remainder.

## 7. After 2017: read architectures as edits

Describe a later model by what it changes:

- **Stacks.** [BERT](https://arxiv.org/abs/1810.04805) is a multi-layer bidirectional Transformer encoder. [Liu et al. (2018)](https://arxiv.org/abs/1801.10198) dropped the encoder, joined input and output into one sequence and trained the decoder as a language model.
- **Normalization.** Pre-normalization computes `x + Sublayer(LayerNorm(x))` and adds a final LayerNorm before the output; the original computes `LayerNorm(x + Sublayer(x))`. [Xiong et al. (2020)](https://arxiv.org/abs/2002.04745) describe this layout as recently proposed and analyse why it can train without warm-up.
- **Position.** A later model may use learned position embeddings (already tested in 2017) or rotary embeddings instead of added sinusoids.
- **Attention kernels.** [FlashAttention](https://arxiv.org/abs/2205.14135) computes the same exact attention in tiles without writing the full score matrix to GPU high-bandwidth memory.

Check every such edit against its primary sources.

## 8. A self-check routine

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
- [Wiegreffe & Pinter, Attention is not not Explanation (2019)](https://aclanthology.org/D19-1002/): a response arguing that the answer depends on how explanation is defined and tested.
- [Pascanu, Mikolov & Bengio, On the difficulty of training Recurrent Neural Networks (2013)](https://arxiv.org/abs/1211.5063): vanishing and exploding gradients; gradient norm clipping.
- [Bahdanau, Cho & Bengio, Neural Machine Translation by Jointly Learning to Align and Translate (2014)](https://arxiv.org/abs/1409.0473): the fixed-length-vector bottleneck and an RNN encoder–decoder with attention.
- [Ba, Kiros & Hinton, Layer Normalization (2016)](https://arxiv.org/abs/1607.06450): per-example feature statistics with a learned gain and bias.
- [Xiong et al., On Layer Normalization in the Transformer Architecture (2020)](https://arxiv.org/abs/2002.04745): post-norm, pre-norm and learning-rate warm-up.
- [Su et al., RoFormer: Enhanced Transformer with Rotary Position Embedding (2021)](https://arxiv.org/abs/2104.09864): rotating queries and keys by position.
- [Dao et al., FlashAttention (2022)](https://arxiv.org/abs/2205.14135): exact attention with fewer high-bandwidth-memory reads and writes.
- [Devlin et al., BERT (2018)](https://arxiv.org/abs/1810.04805): an encoder-only descendant.
- [Liu et al., Generating Wikipedia by Summarizing Long Sequences (2018)](https://arxiv.org/abs/1801.10198): a decoder-only Transformer.

All examples and teaching prose in this guide are original. No paper figures are reproduced.

## New experiments in version 1.1

**Residual + normalization:** Add `x = [1, 2, 3, 4]` and `s = [0.5, −0.5, 1, −1]` to get `r = [1.5, 1.5, 4, 3]`. Its mean is 2.5. Squared centered coordinates sum to 4.5, so the population variance is 4.5 / 4 = 1.125. Divide each centered coordinate by `sqrt(1.125 + epsilon)`, then apply gain and bias. Setting all residual coordinates equal gives zero normalized features. This is post-normalization, as in the original Transformer; a pre-norm sublayer sees a different input.

**Attention storage:** A dense score tensor for one batch item has `heads × tokens²` entries. At 1024 tokens, eight heads and two bytes per score, it occupies 16 MiB. Doubling tokens quadruples this size. This estimate excludes other activations, parameters and gradients. Memory-efficient algorithms such as [FlashAttention](https://arxiv.org/abs/2205.14135) avoid materializing the entire score matrix; they do not remove all pairwise arithmetic.

The site now includes 16 checkpoints, concept search and a 12-term glossary. Progress import merges chapter marks and keeps already-correct local answers when an older export contains a wrong answer.

## New in version 1.2

- **Experiment 04 · scale before softmax:** a fixed-seed sample of 2,000 query–key pairs shows `Var(q · k) ≈ d_k`, and an exact comparison shows the softmax slope collapsing without `1/√d_k` (section 4 above).
- **Position offset check:** Experiment 05 now verifies `PE(p + 1) = R · PE(p)` for two of the four frequency pairs, with one fixed rotation `R` per pair (section 5).
- **CNN shift experiment:** a Clear image control makes the translation-equivariance example in section 2 reproducible.
- **New explanations:** the paper's Table 1 comparison, the training recipe and warm-up arithmetic, per-layer parameter counts, the path from RNN encoder–decoders to attention, LSTM gating and gradient clipping, and a map of later architectures (sections 3–7).
- **Correction:** the RNN lab previously suggested comparing `w_h = 0` with `w_h = 1.5` to show that a larger memory weight need not give a larger final gradient. That pair increases the gradient (from exactly 0 to about 0.109). The lab now compares `w_h = 1.2` with `w_h = 2.0`, which does show the effect (section 3).

The site now has 25 checkpoints, a 20-concept glossary, six guided experiments and thirteen entries in its source list.
