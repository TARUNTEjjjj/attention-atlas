// Original teaching material. The numerical labs use illustrative, untrained weights.
export const lessons = [
  {
    id: 'foundations',
    title: 'Three ways to connect information',
    kicker: '01 / Start with the idea',
    summary: 'A neighbourhood, a memory, or a conversation. Architecture decides which information can meet.',
    body: `<h3>A network is a composition of functions</h3>
      <p>You do not need a deep-learning framework to follow this course. A vector is an ordered list of numbers; a matrix is a table that defines a linear transformation. A neural network combines these transformations with nonlinear functions. Its architecture specifies how values travel. Its weights specify the particular function it computes.</p>
      <div class="formula">z = Wx + b &nbsp; → &nbsp; h = φ(z)</div>
      <p>Here <strong>x</strong> is an input, <strong>W</strong> contains weights, <strong>b</strong> is a bias, and <strong>φ</strong> might be ReLU or tanh. ReLU keeps positive values and replaces negative values with zero. Tanh smoothly maps real numbers into the interval (−1, 1).</p>
      <h3>The same ingredients, different connections</h3>
      <ul><li><strong>CNN:</strong> reuse a small filter at many locations. Nearby pixels interact first; deeper layers can combine larger regions.</li><li><strong>RNN:</strong> update a state as inputs arrive. The next computation depends on the previous state.</li><li><strong>Attention:</strong> compute a set of input-dependent mixing weights, then combine information from permitted positions.</li></ul>
      <p>None is universally best. Spatial structure, streaming constraints, sequence length, available data, and compute all matter. Our small labs isolate each mechanism so you can calculate every intermediate value.</p>
      <details><summary>What does learning change?</summary><p>A loss measures a prediction's error. Backpropagation applies the chain rule to find derivatives of that loss with respect to weights. An optimizer uses those derivatives to update the weights. These labs demonstrate forward computations and selected derivatives; they do not train a language or vision model.</p><p>For example, if L = (wx − y)², then ∂L/∂w = 2(wx − y)x. One gradient-descent step is w ← w − η∂L/∂w, where η is the learning rate.</p></details>
      <h3>How to use the labs</h3><p>Predict a result, change one control, and compare the result with your prediction. Read the arithmetic before increasing the complexity. The checkpoints test understanding, not memorisation of software syntax.</p>`
  },
  {
    id: 'cnn',
    title: 'CNN · find a pattern, then reuse it',
    kicker: '02 / Local structure',
    summary: 'Move one filter across an image and watch a feature map emerge.',
    body: `<h3>One window, one number</h3>
      <p>Take a small image patch and a filter of the same size. Multiply corresponding entries and add them. Sliding that filter across the image creates a feature map. A positive response means agreement with the filter's signs; a negative response can carry useful information too.</p>
      <div class="formula">Y[r,c] = Σᵢ Σⱼ K[i,j] X[rs + i − p, cs + j − p]</div>
      <p><strong>s</strong> is stride and <strong>p</strong> is zero-padding. Outside-image values are zero. The lab uses the cross-correlation convention common in neural-network libraries: it does not reverse the kernel. Mathematical convolution reverses it. <a href="https://docs.pytorch.org/docs/stable/generated/torch.nn.Conv2d.html" target="_blank" rel="noopener noreferrer">Check the PyTorch definition ↗</a></p>
      <h3>Predict the shape first</h3>
      <div class="formula">output size = floor((input size + 2p − kernel size) / s) + 1</div>
      <p>Apply this separately to height and width, with dilation equal to one. A 5 × 5 input and a 3 × 3 filter produce a 3 × 3 map at stride 1 without padding. At stride 2, the map is 2 × 2. Adding one zero border at stride 1 restores a 5 × 5 output.</p>
      <details><summary>From a filter to a CNN architecture</summary><p>A typical image classifier alternates convolutions and nonlinearities, sometimes downsampling with pooling or a strided convolution, then maps its final representation to class scores. Real layers usually have many input and output channels. In a standard convolution without channel grouping, every output channel has a filter spanning every input channel, and those channel responses are summed.</p><p>Such a layer with Cᵢ input channels, Cₒ output channels, a k × k kernel and one bias per output channel has Cₒ(Cᵢk² + 1) parameters. Sharing these parameters across positions is why the count does not grow with image width.</p></details>
      <h3>Look beyond the coloured square</h3><p>The receptive field is the input region able to influence a unit. Two stride-1, 3 × 3 layers have a 5 × 5 receptive field. Pooling discards detail; a translated input does not guarantee an identical classifier output. Test edge locations and padding before assuming perfect translation behaviour.</p>`
  },
  {
    id: 'rnn',
    title: 'RNN · carry a state through time',
    kicker: '03 / Sequential memory',
    summary: 'Step through a recurrence and discover why a long memory can be difficult to learn.',
    body: `<h3>The state is a computed summary</h3>
      <p>An RNN applies the same update rule repeatedly. Its state is not a literal transcript: it is a vector shaped by the weights and all earlier inputs. Our lab uses a single number so the recurrence stays visible.</p>
      <div class="formula">hₜ = tanh(wₓxₜ + wₕhₜ₋₁ + b), &nbsp; h₀ given</div>
      <p>Multiply the current input by its weight, add the weighted previous state and bias, then apply tanh. Unrolling the network draws one copy of this calculation per time step, but the copies share parameters. For vector states, wₓ and wₕ become matrices. <a href="https://docs.pytorch.org/docs/stable/generated/torch.nn.RNN.html" target="_blank" rel="noopener noreferrer">Compare the official RNN equations ↗</a></p>
      <h3>Follow the derivative as well as the value</h3>
      <div class="formula">∂hₜ/∂hₜ₋₁ = wₕ(1 − hₜ²)</div>
      <p>The chain rule multiplies these local derivatives across time. If their magnitudes are repeatedly below one, a later state becomes insensitive to an earlier state. Products above one can amplify that sensitivity. A saturated tanh is close to −1 or 1 and has a small derivative.</p>
      <p>At zero input and zero bias with h₀ = 0, the states remain zero. Set wₕ = 0.5: after six steps, ∂h₆/∂h₀ = 0.5⁶ = 1/64. This calculation describes sensitivity to the initial state, not the complete gradient of a training loss.</p>
      <details><summary>Why “large recurrent weight” is not the whole story</summary><p>Even wₕ greater than one can produce a small derivative when tanh saturates. In a vector RNN, gradients involve products of Jacobian matrices, so direction and activation values matter too. LSTMs and GRUs introduce gates and additional paths for state updates; they make different learning dynamics possible, rather than guaranteeing unlimited memory.</p></details>
      <h3>A useful engineering trade-off</h3><p>A recurrent state supports streaming with bounded state size. Within one ordinary recurrence, however, hₜ must be available before hₜ₊₁ can be computed. Try reversing the inputs: shared weights do not make a recurrence order-independent.</p>`
  },
  {
    id: 'attention',
    title: 'Attention · calculate who reads what',
    kicker: '04 / Content-dependent mixing',
    summary: 'Inspect queries, keys, scores, probabilities, and the resulting value mixture.',
    body: `<h3>Separate matching from information</h3>
      <p>A query is compared with keys to determine mixing weights. Values contain the vectors being mixed. In this lab, the small matrices are editable teaching examples, not embeddings learned from text. A word label is only a label: a bright cell does not demonstrate language understanding.</p>
      <div class="formula">S = QKᵀ / √dₖ &nbsp; → &nbsp; A = softmax(S) &nbsp; → &nbsp; O = AV</div>
      <p>The softmax acts independently on each query row. If Q is n × dₖ, K is m × dₖ, and V is m × dᵥ, then A is n × m and O is n × dᵥ. The matching dimension and value dimension need not be equal.</p>
      <h3>A weighted average you can verify</h3>
      <p>Suppose two scores are 0 and ln(3). Their exponentials are 1 and 3, so the weights are 1/4 and 3/4. For scalar values 2 and 10, the output is (1/4)·2 + (3/4)·10 = 8. Every row sums to one, and each output coordinate lies between the smallest and largest corresponding allowed value coordinates.</p>
      <details><summary>Why softmax is computed with a subtraction</summary><div class="formula">softmax(s)ⱼ = exp(sⱼ − max(s)) / Σₖ exp(sₖ − max(s))</div><p>Subtracting the same finite constant from every score leaves the ratio unchanged. Choosing the maximum avoids exponentiating huge positive numbers. The optional temperature divides scores before softmax: smaller positive temperatures sharpen unequal scores, while larger ones flatten them. Temperature is an experiment control here, not an extra parameter in the original attention equation.</p></details>
      <h3>Mask before normalising</h3><p>A causal mask excludes future keys. Conceptually, their scores become −∞ so their probabilities are exactly zero. Replacing their scores with zero would still give them positive probability. The remaining permitted keys must be normalised again.</p>
      <p>Attention weights describe this mixing operation. They are not, by themselves, proof that a token caused a model's final decision. <a href="https://aclanthology.org/N19-1357/" target="_blank" rel="noopener noreferrer">Read the interpretability study ↗</a></p>`
  },
  {
    id: 'transformer',
    title: 'Transformer · assemble the system',
    kicker: '05 / Inside the 2017 architecture',
    summary: 'Connect attention with position, nonlinear transformations, residual paths, and a decoder.',
    body: `<h3>Read the original design precisely</h3>
      <p><em>Attention Is All You Need</em> introduced an encoder–decoder translation architecture. Its base configuration has six encoder layers and six decoder layers, model width 512, eight attention heads with 64-dimensional keys and values, and feed-forward width 2048. The encoder uses self-attention; the decoder uses causal self-attention followed by cross-attention to encoder outputs. The original residual blocks apply LayerNorm after addition. Target inputs are shifted during training, and the causal mask prevents access to later target positions. Sinusoidal position vectors are added to embeddings. This architecture is not the same as a modern decoder-only language model. <a href="https://arxiv.org/abs/1706.03762" target="_blank" rel="noopener noreferrer">Read Vaswani et al., 2017, sections 3–4 ↗</a></p>
      <h3>Three independent questions at every block</h3>
      <ul><li><strong>Where can information travel?</strong> Inspect the permitted attention connections. In cross-attention, decoder representations supply queries and encoder representations supply keys and values.</li><li><strong>How is each position transformed?</strong> A feed-forward network changes features within each position using shared weights. Its nonlinearity makes it more than one matrix multiplication.</li><li><strong>Can an earlier representation survive?</strong> A residual connection adds the sublayer's output to its input. This requires compatible dimensions.</li></ul>
      <div class="formula">residual update: y = LayerNorm(x + f(x))</div>
      <details><summary>Why positions need a representation</summary><p>Imagine shuffling every row of an input and then undoing that shuffle on the output. Without positional information or an order-sensitive mask, self-attention follows that shuffle; it has no separate clock identifying “first” or “third.” A positional signal supplies information about sequence order. In the position explorer, compare two positions component by component rather than treating a colourful vector as a word meaning.</p></details>
      <h3>Parallel work does not mean free work</h3><p>For n positions, dense attention forms n² pairwise scores per head. Doubling sequence length quadruples the score count. Projections and feed-forward layers also consume compute. Training can process known target positions together under a mask, while ordinary autoregressive generation must wait for each newly generated token before producing the next.</p>
      <p>Use the architecture diagram to trace one source token into an encoder state, then into the decoder's cross-attention. Use the numerical attention lab to understand the operation inside each attention block.</p>`
  },
  {
    id: 'practice',
    title: 'Predict. Calculate. Explain.',
    kicker: '06 / Check your understanding',
    summary: 'Use the labs as a scratchpad, then test whether you can explain the result.',
    body: `<h3>Make each checkpoint an experiment</h3>
      <p>Choose an answer before opening its explanation. If you miss one, return to the relevant lab, change a single variable, and test the rule again. A correct guess is a starting point; being able to reproduce the arithmetic is the goal.</p>
      <ul><li><strong>CNN challenge:</strong> predict the output size before changing stride or padding. Find a patch that produces a negative filter response.</li><li><strong>RNN challenge:</strong> keep the initial state and inputs at zero. Compare six-step sensitivity for recurrent weights 0.5 and 1.2, then add a large input and observe saturation.</li><li><strong>Attention challenge:</strong> make all allowed scores equal. Predict the output from the values alone. Turn on a causal mask and explain why the first query has only one allowed key.</li><li><strong>Architecture challenge:</strong> explain why removing positional information changes what an unmasked self-attention layer can distinguish.</li></ul>
      <details><summary>What to build next</summary><p>Implement a convolution by hand before comparing it with a framework. Differentiate a tiny recurrent network with finite differences. Reproduce a small attention calculation using matrix multiplication. Finally, build a small trained model with a held-out test set. Forward-pass understanding is a foundation; data preparation, optimization, evaluation, and reproducibility are separate skills to practise.</p></details>
      <p>Your progress is stored in this browser, without an account. It is a learning aid, not a certificate or an assessment of professional proficiency.</p>`
  }
];

export const quiz = [
  { id: 'dot-product', topic: 'foundations', question: 'What is the dot product of [1, 2] and [3, −1]?', choices: ['1', '5', '−2', '[3, −2]'], answer: 0, explanation: 'Multiply matching coordinates, then add: 1·3 + 2·(−1) = 3 − 2 = 1. A dot product returns one number.' },
  { id: 'cnn-shape', topic: 'cnn', question: 'A 5 × 5 input uses a 3 × 3 filter, stride 2, no padding, and dilation 1. What is the output shape?', choices: ['3 × 3', '2 × 2', '1 × 1', '5 × 5'], answer: 1, explanation: 'Each side is floor((5 − 3)/2) + 1 = 2. Valid starting indices are 0 and 2.' },
  { id: 'cnn-patch', topic: 'cnn', question: 'An all-ones 3 × 3 patch meets a filter with each row [1, 0, −1], with no bias. What is its response?', choices: ['9', '3', '0', '−3'], answer: 2, explanation: 'Every row contributes 1 + 0 − 1 = 0. Adding three zero row sums gives zero: this filter cancels a constant patch.' },
  { id: 'cnn-sharing', topic: 'cnn', question: 'A 3 × 3 convolution has 2 input channels and 4 output channels, with one bias per output channel. How many parameters?', choices: ['36', '72', '76', 'Depends on image width'], answer: 2, explanation: 'Each output channel uses 2·3·3 = 18 weights and one bias. Four output channels give 4·19 = 76. The same weights are reused across spatial positions.' },
  { id: 'rnn-zero', topic: 'rnn', question: 'For hₜ = tanh(0.8xₜ + 0.7hₜ₋₁), with xₜ = 0 and h₀ = 0, what is h₃?', choices: ['0.7³', '0', '1', 'tanh(0.8)'], answer: 1, explanation: 'Every preactivation is zero, and tanh(0) = 0. A zero state can still have nonzero sensitivity to a perturbation of its initial value.' },
  { id: 'rnn-gradient', topic: 'rnn', question: 'At zero inputs, zero bias and h₀ = 0, a scalar tanh RNN has wₕ = 0.5. What is ∂h₃/∂h₀?', choices: ['1.5', '0.5', '0.125', '0'], answer: 2, explanation: 'Each local derivative is 0.5·(1 − 0²) = 0.5. The chain rule multiplies three factors: 0.5³ = 0.125.' },
  { id: 'rnn-saturation', topic: 'rnn', question: 'When a tanh hidden state approaches 1, what happens to its activation derivative 1 − h²?', choices: ['It approaches zero', 'It approaches infinity', 'It becomes exactly −1', 'It must stay equal to one'], answer: 0, explanation: 'As h² approaches one, 1 − h² approaches zero. Saturation can attenuate gradients even when the recurrent weight exceeds one.' },
  { id: 'attention-average', topic: 'attention', question: 'Two allowed keys have equal scores and scalar values 2 and 10. What is the attention output?', choices: ['2', '10', '12', '6'], answer: 3, explanation: 'Equal scores receive equal softmax weights, here 1/2 each. The weighted average is (2 + 10)/2 = 6.' },
  { id: 'causal-mask', topic: 'attention', question: 'Why are disallowed attention scores set to −∞ before softmax, rather than zero?', choices: ['Zero produces negative weights', 'exp(0) = 1, so zero still permits positive weight', 'Softmax requires every score to be negative', 'The mask changes the value vectors'], answer: 1, explanation: 'A score of zero has a positive exponential. A score of −∞ contributes zero; normalisation then distributes probability only among allowed keys.' },
  { id: 'attention-shape', topic: 'attention', question: 'Q has shape 3 × 2, K is 4 × 2, and V is 4 × 5. What is the attention output shape?', choices: ['3 × 5', '4 × 5', '3 × 4', '2 × 5'], answer: 0, explanation: 'QKᵀ is 3 × 4. Its row-normalised weights multiply V of shape 4 × 5, producing a 3 × 5 output.' },
  { id: 'cross-attention', topic: 'transformer', question: 'In encoder–decoder cross-attention, where do the keys and values come from?', choices: ['The next target token', 'The decoder mask', 'Encoder output representations', 'The final probability distribution'], answer: 2, explanation: 'The decoder supplies queries, while encoder outputs supply keys and values. This lets a decoder position read the encoded source sequence.' },
  { id: 'quadratic-scores', topic: 'transformer', question: 'For one dense self-attention head, increasing sequence length from n to 2n changes the number of pairwise scores by what factor?', choices: ['2', '4', '8', 'No change'], answer: 1, explanation: 'The score matrix grows from n × n to 2n × 2n, so it has four times as many entries. This counts scores, not the complete model runtime.' }
];

quiz.push(
  {id:'residual-sum',topic:'transformer',question:'A residual block adds input [1, 2] to sublayer output [−1, 3]. What is the vector before normalization?',choices:['[0, 5]','[−1, 6]','[1, 3]','[2, 5]'],answer:0,explanation:'A residual connection adds matching coordinates: [1 + (−1), 2 + 3] = [0, 5]. Normalization is a separate operation applied afterward in the original Transformer.'},
  {id:'layernorm-variance',topic:'transformer',question:'For LayerNorm applied to [1, 3], what are the feature mean and population variance before epsilon is added?',choices:['Mean 2, variance 1','Mean 2, variance 2','Mean 1, variance 3','Mean 0, variance 1'],answer:0,explanation:'The mean is (1 + 3)/2 = 2. The centered values are [−1, 1], so population variance is ((−1)² + 1²)/2 = 1. LayerNorm uses population variance; epsilon is added under the square root.'},
  {id:'score-memory',topic:'transformer',question:'For 8 dense attention heads, 1024 tokens and 2 bytes per score, how much memory does one score tensor need?',choices:['2 MiB','8 MiB','16 MiB','32 MiB'],answer:2,explanation:'The tensor has 8 × 1024 × 1024 scores. Multiply by 2 bytes and divide by 1,048,576 bytes per MiB to get 16 MiB. This excludes activations, gradients, parameters and other tensors.'},
  {id:'normalization-shift',topic:'transformer',question:'With the same epsilon, gamma and beta, what happens to LayerNorm when you add the same constant to every input coordinate?',choices:['The result shifts by that constant','The result stays the same, up to floating-point rounding','The variance doubles','The result becomes zero'],answer:1,explanation:'The mean increases by the same constant. Subtracting that mean removes the shift, leaving the same centered values and variance. The normalized result therefore stays the same, apart from finite-precision effects.'}
);

export const sources = [
  { title: 'Attention Is All You Need · Vaswani et al. (2017)', url: 'https://arxiv.org/abs/1706.03762', note: 'The original Transformer paper. Start with sections 3.1–3.5 for the architecture and section 4 for its computational trade-offs.' },
  { title: 'Conv2d · PyTorch documentation', url: 'https://docs.pytorch.org/docs/stable/generated/torch.nn.Conv2d.html', note: 'Reference for cross-correlation, channels, stride, padding, dilation, and output shapes.' },
  { title: 'RNN · PyTorch documentation', url: 'https://docs.pytorch.org/docs/stable/generated/torch.nn.RNN.html', note: 'A precise vector recurrence and the shapes used by a practical recurrent layer.' },
  { title: 'Attention is not Explanation · Jain & Wallace (2019)', url: 'https://aclanthology.org/N19-1357/', note: 'Experimental evidence for treating attention visualisations cautiously when explaining predictions.' }
];
