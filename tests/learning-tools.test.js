import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {searchLearningItems} from '../src/learning-tools.js';

test('learning search: empty input offers exactly the six chapter routes',()=>{
 const results=searchLearningItems('   ');
 assert.deepEqual(results.map(x=>x.target),['foundations','cnn','rnn','attention','transformer','practice']);
 assert.equal(new Set(results.map(x=>x.id)).size,6);
});
test('learning search: case, surrounding spaces and CNN/RNN aliases are normalized',()=>{
 assert.equal(searchLearningItems('  cNn  ')[0].id,'chapter-cnn');
 assert.equal(searchLearningItems('recurrent   neural network')[0].id,'chapter-rnn');
 assert.deepEqual(searchLearningItems('  RNN '),searchLearningItems('rnn'));
});
test('learning search: mathematical single-letter aliases match exactly',()=>{
 for(const [query,id] of [['Q','term-query'],['K','term-key'],['V','term-value']])assert.equal(searchLearningItems(query)[0].id,id);
 assert.ok(searchLearningItems('Q').length<4);
});
test('learning search: Unicode width, accents and hyphens produce useful matches',()=>{
 assert.equal(searchLearningItems('ＣＮＮ')[0].id,'chapter-cnn');
 assert.equal(searchLearningItems('résidual')[0].id,'term-residual');
 assert.equal(searchLearningItems('hidden‑state')[0].id,'term-hidden-state');
 assert.equal(searchLearningItems('layer—normalisation')[0].id,'term-layernorm');
});
test('learning search: all query words are required; prefixes are supported',()=>{
 assert.equal(searchLearningItems('receptive fie')[0].id,'term-receptive-field');
 assert.deepEqual(searchLearningItems('receptive quantum'),[]);
 assert.ok(searchLearningItems('grad').some(x=>x.id==='term-gradient'));
});
test('learning search: layer norm aliases reach the Transformer chapter',()=>{
 for(const term of ['LayerNorm','layer norm','layer normalization']){
  const first=searchLearningItems(term)[0];assert.equal(first.id,'term-layernorm');assert.equal(first.target,'transformer');
 }
});
test('learning search: unknown or non-text input is safe and yields no results',()=>{
 for(const query of [null,undefined,42,{},[],false])assert.deepEqual(searchLearningItems(query),[]);
 assert.deepEqual(searchLearningItems('quantum entanglement'),[]);
 assert.deepEqual(searchLearningItems('<img src=x onerror=alert(1)>'),[]);
});
test('learning search: a typed query of only symbols or punctuation matches nothing, not every chapter',()=>{
 // The search box reports a typed query as "N matches", so returning the empty-box chapter list here would claim 6 false matches.
 for(const query of ['???','√','×','∑','!','...','<>','—','“ ”'])assert.deepEqual(searchLearningItems(query),[],`query ${JSON.stringify(query)}`);
 assert.equal(searchLearningItems('').length,6);
});
test('learning search: returned data cannot mutate the shared index',()=>{
 const first=searchLearningItems('softmax')[0];first.title='changed';first.aliases.push('attacker');
 const next=searchLearningItems('softmax')[0];assert.equal(next.title,'Softmax');assert.ok(!next.aliases.includes('attacker'));
});
test('learning search: version 1.2 concepts are reachable by their common names',()=>{
 for(const [query,id,target] of [['sqrt dk','term-scaling','attention'],['√dₖ','term-scaling','attention'],['multi-head','term-multihead','attention'],['cross attention','term-cross-attention','transformer'],['FFN','term-ffn','transformer'],['feed-forward','term-ffn','transformer'],['RoPE','term-position','transformer'],['sinusoidal','term-position','transformer'],['path length','term-path-length','transformer'],['warm-up','term-warmup','transformer'],['learning rate','term-warmup','transformer'],['equivariance','term-equivariance','cnn']]){
  const first=searchLearningItems(query)[0];assert.equal(first?.id,id,`${query} should find ${id}`);assert.equal(first.target,target);
 }
});
test('learning content: glossary IDs are unique and guided experiments point at real chapters',async()=>{
 const {learningContent}=await import('../src/learning-tools.js');
 const {glossary,experiments}=learningContent();
 assert.equal(glossary.length,20);assert.equal(new Set(glossary.map(x=>x.id)).size,glossary.length);
 assert.equal(experiments.length,6);
 for(const x of experiments){assert.match(x.chapter,/^(foundations|cnn|rnn|attention|transformer|practice)$/);assert.ok(x.steps.length>60&&x.question.endsWith('?'));}
 const copy=learningContent();copy.glossary[0].aliases.push('attacker');assert.ok(!learningContent().glossary[0].aliases.includes('attacker'));
});
test('learning search: results always use fixed internal anchors and explanatory prose',()=>{
 const terms=['query','key','value','softmax','convolution','receptive field','hidden state','gradient','residual','layernorm','causal','embedding','scaled dot product','multi head attention','positional encoding','warmup','path length','equivariance'];
 for(const query of terms){const item=searchLearningItems(query)[0];assert.match(item.target,/^(foundations|cnn|rnn|attention|transformer|practice)$/);assert.ok(item.description.length>40);assert.ok(!/[<>]/.test(item.title));}
});
test('learning search: notation finds the concepts whose formulas use it, and a one-letter symbol is not matched in prose',()=>{
 // "q · k" is the scaling lab's RAW SCORES label. Value's prose ("when Q and K stay fixed") used to be its only match.
 const ids=query=>searchLearningItems(query).map(x=>x.id);
 for(const query of ['q · k','q·k','Q · K','Q K','Q and K'])assert.deepEqual(ids(query),['term-scaling','term-query','term-key'],query);
 assert.deepEqual(ids('QKᵀ'),['term-key']);
 assert.deepEqual(ids('s'),['term-softmax'],'the score sⱼ in the softmax formula, not the "s" left by "RNN’s"');
 assert.ok(ids('k').includes('term-query'),'kⱼ in the query formula is the symbol k');
 assert.ok(!ids('Q').includes('term-value'));
});
test('learning search: an article or a possessive in the query finds what the query finds without it',()=>{
 // "a" and the "s" of "RNN's" are one-letter words, and a one-letter word is looked for as a symbol in each entry's
 // notation. No entry has them there, so each of these said "0 matches. Try a shorter term…".
 const ids=query=>searchLearningItems(query).map(x=>x.id);
 for(const [query,plain] of [['a filter','filter'],['a kernel','kernel'],['a hidden state','hidden state'],['A Causal Mask','causal mask'],['an RNN','rnn'],['an embedding','embedding'],
  ["RNN's memory",'rnn memory'],['RNN’s hidden state','rnn hidden state'],["RNN'S MEMORY",'rnn memory'],["the model's",'the model'],["network's",'network'],['ＲＮＮ＇ｓ memory','rnn memory']]){
  assert.ok(ids(plain).length>0,plain);
  assert.deepEqual(ids(query),ids(plain),`${JSON.stringify(query)} should find what ${JSON.stringify(plain)} finds`);
 }
 assert.deepEqual(ids('a filter'),['chapter-cnn','term-convolution','term-receptive-field','term-equivariance']);
 assert.deepEqual(ids("RNN's memory"),['chapter-rnn','term-hidden-state']);
 assert.equal(ids('a hidden state')[0],'term-hidden-state','the alias is still an exact match once the article is dropped');
 assert.ok(ids("the model's").includes('term-ffn')&&ids("network's").includes('term-ffn'));
 // The article and the possessive are dropped, not the symbols beside them.
 assert.deepEqual(ids("a q · k"),ids('q · k'));
 assert.deepEqual(ids("Q's"),ids('Q'));
 assert.deepEqual(ids("'s'"),ids('s'),'a quoted s is the symbol s, not a possessive');
 // A query of nothing but such words is searched as typed: "an" finds the entries that say "an", not every entry.
 assert.ok(ids('an').includes('term-hidden-state')&&!ids('an').includes('term-softmax'));
 assert.ok(ids('and').length>0);
});
test('page modules: no regular expression uses a lookbehind, which iPhone Safari before 16.4 cannot parse',async()=>{
 // (?<=…) or (?<!…) is a syntax error there. The module then fails to load, and app.js and the whole page with it.
 const src=new URL('../src/',import.meta.url),modules=(await readdir(src)).filter(name=>name.endsWith('.js'));
 assert.ok(modules.includes('learning-tools.js')&&modules.includes('app.js'));
 for(const name of modules)assert.doesNotMatch(await readFile(new URL(name,src),'utf8'),/\(\?<[=!]/,`src/${name}`);
});
test('learning search: one-letter words that no entry has together as notation are searched as ordinary words',()=>{
 const ids=query=>searchLearningItems(query).map(x=>x.id);
 // No entry's notation holds q, k and v, so "Q K V" went from one match to none. Value's description names Q and K.
 for(const query of ['Q K V','Q, K, V','Q/K/V','k and v'])assert.deepEqual(ids(query),['term-value'],query);
 // That reading is only for a query the notation cannot answer: it adds nothing to one it can.
 for(const query of ['q · k','Q K','k'])assert.ok(!ids(query).includes('term-value'),query);
 assert.deepEqual(ids('q k x'),[],'still nothing when no entry has the words anywhere');
});
