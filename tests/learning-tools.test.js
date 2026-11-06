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
test('learning search: a typed query of only symbols or punctuation matches nothing, not every chapter',()=>{
 // The search box reports a typed query as "N matches", so returning the empty-box chapter list here would claim 6 false matches.
 for(const query of ['???','√','×','∑','!','...','<>','—','“ ”'])assert.deepEqual(searchLearningItems(query),[],`query ${JSON.stringify(query)}`);
 assert.equal(searchLearningItems('').length,6);
});
test('learning search: returned data cannot mutate the shared index',()=>{
 const first=searchLearningItems('softmax')[0];first.title='changed';first.aliases.push('attacker');
 const next=searchLearningItems('softmax')[0];assert.equal(next.title,'Softmax');assert.ok(!next.aliases.includes('attacker'));
});
test('learning search: results always use fixed internal anchors and explanatory prose',()=>{
 const terms=['query','key','value','softmax','convolution','receptive field','hidden state','gradient','residual','layernorm','causal','embedding'];
 for(const query of terms){const item=searchLearningItems(query)[0];assert.match(item.target,/^(foundations|cnn|rnn|attention|transformer|practice)$/);assert.ok(item.description.length>40);assert.ok(!/[<>]/.test(item.title));}
});
