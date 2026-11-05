import test from 'node:test';
import assert from 'node:assert/strict';
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
