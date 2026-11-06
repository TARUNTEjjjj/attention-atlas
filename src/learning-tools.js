/** Small, local learning index. Search never sends a request or evaluates input. */
const chapters = [
  { id:'chapter-foundations', kind:'Chapter', title:'Foundations', target:'foundations', aliases:['start','introduction','basics','vectors','matrices','dot product'], description:'Connect vectors, weighted sums and nonlinear functions before entering the labs.' },
  { id:'chapter-cnn', kind:'Chapter', title:'CNN · local patterns', target:'cnn', aliases:['cnn','convolutional neural network','image','filter','stride','padding'], description:'Move a shared filter and predict which output cells change.' },
  { id:'chapter-rnn', kind:'Chapter', title:'RNN · recurrent memory', target:'rnn', aliases:['rnn','recurrent neural network','recurrence','sequence','memory','tanh'], description:'Follow a hidden state through time and inspect its derivatives.' },
  { id:'chapter-attention', kind:'Chapter', title:'Attention · weighted connections', target:'attention', aliases:['attention','qkv','queries keys values','heads','mask'], description:'Calculate matching scores, normalize them and combine values.' },
  { id:'chapter-transformer', kind:'Chapter', title:'Transformer · the whole system', target:'transformer', aliases:['transformer','encoder','decoder','positions','normalization','complexity'], description:'Trace encoder–decoder blocks and explore the cost of connecting tokens.' },
  { id:'chapter-practice', kind:'Chapter', title:'Practice · check your reasoning', target:'practice', aliases:['practice','quiz','questions','exercises','test'], description:'Predict numerical and architectural results, then read the explanation.' }
];
const glossary = [
  { id:'term-query', kind:'Concept', title:'Query (Q)', target:'attention', aliases:['q','query','queries','query vector'], description:'A vector used to score candidate keys. For one query, the scores determine how strongly each allowed value enters the output.', formula:'scoreⱼ = q · kⱼ / √dₖ' },
  { id:'term-key', kind:'Concept', title:'Key (K)', target:'attention', aliases:['k','key','keys','key vector'], description:'A vector compared with a query. A key participates in matching; its paired value supplies the information being mixed.', formula:'QKᵀ has one score for each query–key pair.' },
  { id:'term-value', kind:'Concept', title:'Value (V)', target:'attention', aliases:['v','value','values','value vector'], description:'The information vector multiplied by an attention weight. Changing values can change outputs without changing the weights when Q and K stay fixed.', formula:'output = Σⱼ weightⱼ · valueⱼ' },
  { id:'term-softmax', kind:'Concept', title:'Softmax', target:'attention', aliases:['softmax','probabilities','normalization','exponential'], description:'Turns finite scores into positive weights that sum to one. A masked score of −∞ receives zero weight. Subtract the largest allowed score before exponentiating for numerical stability.', formula:'weightⱼ = exp(sⱼ − max(s)) / Σₖ exp(sₖ − max(s))' },
  { id:'term-convolution', kind:'Concept', title:'Convolution', target:'cnn', aliases:['convolution','convolve','cross correlation','kernel','filter'], description:'In this lab, a shared filter is multiplied with each local patch, then summed. Libraries commonly call this convolution, although the unflipped filter makes it cross-correlation.', formula:'One patch + one filter → one weighted sum.' },
  { id:'term-receptive-field', kind:'Concept', title:'Receptive field', target:'cnn', aliases:['receptive field','neighborhood','neighbourhood','locality'], description:'The input region that can influence a unit. Stacking two stride-1, dilation-1, 3 × 3 filters gives an interior output a 5 × 5 receptive field.', formula:'3 × 3, then 3 × 3 → 5 × 5 receptive field' },
  { id:'term-hidden-state', kind:'Concept', title:'Hidden state', target:'rnn', aliases:['hidden state','state','h','memory'], description:'An RNN’s running representation. It is computed from the current input and previous state; it is a learned summary, not a copy of the entire history.', formula:'hₜ = tanh(wₓxₜ + wₕhₜ₋₁ + b)' },
  { id:'term-gradient', kind:'Concept', title:'Gradient', target:'rnn', aliases:['gradient','derivative','chain rule','vanishing','exploding','sensitivity'], description:'A collection of derivatives describing local sensitivity. In the scalar recurrence, derivatives through time multiply. The lab displays sensitivity to h₀, not the complete gradient of a training loss.', formula:'∂hₜ/∂h₀ = ∏ₖ₌₁ᵗ wₕ(1 − hₖ²)' },
  { id:'term-residual', kind:'Concept', title:'Residual connection', target:'transformer', aliases:['residual','skip connection','addition'], description:'Adds a sublayer’s output to its input, letting the earlier representation take a direct path forward. The two vectors must have compatible shapes.', formula:'residual = x + f(x)' },
  { id:'term-layernorm', kind:'Concept', title:'Layer normalization', target:'transformer', aliases:['layernorm','layer norm','layer normalization','layer normalisation','mean','variance'], description:'Centers and rescales the features of a token using their own mean and population variance, then applies learned scale and shift. Epsilon prevents division by zero.', formula:'yᵢ = γᵢ(xᵢ − μ) / √(σ² + ε) + βᵢ' },
  { id:'term-causal', kind:'Concept', title:'Causal mask', target:'attention', aliases:['causal','causal mask','future','autoregressive','masking'], description:'Excludes future positions before softmax. The current position is allowed. During next-token training, shifting target inputs prevents the answer from being present at that position.', formula:'Allowed key positions j ≤ current query position i.' },
  { id:'term-embedding', kind:'Concept', title:'Embedding', target:'transformer', aliases:['embedding','embeddings','token','representation'], description:'A learned vector associated with an input symbol. It is not a dictionary definition. In the original Transformer, scaled token embeddings are combined with position information.', formula:'input = √d_model · token embedding + position vector' }
];
const index = [...chapters,...glossary];
const normalize = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[‐‑‒–—−_-]/g,' ').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const publicCopy = item => ({ ...item, aliases:[...item.aliases] });

/** Exact words/aliases take precedence over phrase and prefix matches; ties keep authored order. */
export function searchLearningItems(query) {
  if (typeof query !== 'string') return [];
  const needle=normalize(query.slice(0,120));
  // Only a blank box lists the chapters. A typed query that normalizes to nothing (e.g. "???" or "√") matches nothing.
  if (!needle) return query.trim() ? [] : chapters.map(publicCopy);
  const words=needle.split(' ');
  return index.map((item,order)=>{
    const title=normalize(item.title), aliases=item.aliases.map(normalize);
    const searchWords=normalize([item.title,...item.aliases,item.description].join(' ')).split(' ');
    const matches=words.every(word=>searchWords.some(candidate=>candidate===word || (word.length>=3 && candidate.startsWith(word))));
    const score=aliases.includes(needle)?0:title===needle?1:title.includes(needle)?2:3;
    return {item,order,matches,score};
  }).filter(row=>row.matches).sort((a,b)=>a.score-b.score||a.order-b.order).map(row=>publicCopy(row.item));
}

let counter=0;
export function mountLearningTools(container) {
  const instance=`learning-tools-${++counter}`;
  const abort=new AbortController();
  const element=(tag,className,text)=>{
    const node=document.createElement(tag);
    if(className)node.className=className;
    if(text!==undefined)node.textContent=text;
    return node;
  };
  const listen=(node,event,handler)=>node.addEventListener(event,handler,{signal:abort.signal});
  container.replaceChildren();
  container.classList.add('learning-tools');
  const header=element('div','learning-tools-heading');
  const headingCopy=element('div');
  headingCopy.append(element('span','eyebrow','YOUR NEXT DISCOVERY'),element('h2','','Find the idea you need.'));
  header.append(headingCopy,element('p','note','Follow the chapters in order, or look up a concept while you experiment. Search runs on your device.'));
  const form=element('form','learning-search');
  form.setAttribute('role','search');form.setAttribute('aria-label','Search the learning guide');
  const label=element('label','','Find a concept or chapter');label.htmlFor=`${instance}-query`;
  const field=element('div','learning-search-field');
  const input=element('input');input.id=`${instance}-query`;input.type='search';input.placeholder='Try “query”, “gradient”, or “CNN”';input.maxLength=120;input.autocomplete='off';input.spellcheck=false;input.setAttribute('aria-controls',`${instance}-results`);input.setAttribute('aria-describedby',`${instance}-status`);
  const clear=element('button','learning-clear','Clear');clear.type='button';clear.hidden=true;clear.setAttribute('aria-label','Clear learning search');
  field.append(input,clear);form.append(label,field);
  const status=element('p','learning-search-status');status.id=`${instance}-status`;status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const results=element('div','learning-search-results');results.id=`${instance}-results`;
  function render(){
    const query=input.value,hasQuery=query.trim().length>0,matches=searchLearningItems(query);
    clear.hidden=!hasQuery;
    results.replaceChildren();results.classList.toggle('chapter-shortcuts',!hasQuery);
    status.textContent=hasQuery?`${matches.length} ${matches.length===1?'match':'matches'}. ${matches.length?'Choose a result to open its chapter.':'Try a shorter term, such as “memory”, “filter” or “softmax”.'}`:'Six chapters, from the first intuition to independent practice.';
    if(!matches.length){results.append(element('p','learning-empty','No matching concept yet. The glossary below may help you find another name for it.'));return;}
    for(const item of matches){
      const link=element('a','learning-result');link.href=`#${item.target}`;
      link.append(element('span','learning-result-kind',hasQuery?item.kind:'CHAPTER'),element('strong','',item.title));
      if(hasQuery)link.append(element('span','learning-result-description',item.description));
      const arrow=element('span','learning-result-arrow','↗');arrow.setAttribute('aria-hidden','true');link.append(arrow);
      results.append(link);
    }
  }
  listen(input,'input',render);
  listen(input,'keydown',event=>{if(event.key==='Escape'){input.value='';render();}});
  listen(clear,'click',()=>{input.value='';render();input.focus();});
  // Enter focuses the first result; it never submits the local query to a server.
  listen(form,'submit',event=>{event.preventDefault();results.querySelector('a')?.focus();});
  const definitions=element('details','learning-glossary');
  definitions.append(element('summary','','A small glossary for big ideas · 12 concepts'));
  const list=element('dl','glossary-grid');
  for(const item of glossary){
    const group=element('div','glossary-item');
    const term=element('dt','',item.title),definition=element('dd');
    const p=element('p','',item.description),formula=element('p','glossary-formula',item.formula),link=element('a','text-link','Explore in the lab →');link.href=`#${item.target}`;
    definition.append(p,formula,link);group.append(term,definition);list.append(group);
  }
  definitions.append(list);
  const guided=element('details','learning-experiments');guided.append(element('summary','','Three experiments to sharpen your intuition'));
  const experiments=element('div','guided-grid');
  for(const experiment of [
    {chapter:'cnn',number:'01',title:'Make one pixel matter',steps:'Choose the identity filter, stride 1 and padding 1. Predict which feature-map cell changes when you flip one pixel. Then test it.',question:'Why does the identity filter copy the image?'},
    {chapter:'rnn',number:'02',title:'Separate memory from gradient',steps:'Enter six zeros. Set the memory weight to 0.5, then 1. Reveal every state in each case. Both sequences stay zero; the sensitivities differ.',question:'Can two identical forward states have different derivatives?'},
    {chapter:'attention',number:'03',title:'Separate matching from content',steps:'Select the first query and enable the causal mask. Open the vector editor and change only its first value vector. Watch the output and the weights.',question:'Why can the output change while the attention weights stay fixed?'}
  ]){
    const card=element('article','guided-experiment');card.append(element('span','eyebrow',`EXPERIMENT ${experiment.number}`),element('h3','',experiment.title),element('p','',experiment.steps),element('p','guided-question',experiment.question));
    const link=element('a','text-link','Try this experiment →');link.href=`#${experiment.chapter}`;card.append(link);experiments.append(card);
  }
  guided.append(experiments);
  container.append(header,form,status,results,definitions,guided);render();
  return ()=>abort.abort();
}
