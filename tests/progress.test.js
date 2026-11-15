import test from 'node:test';
import assert from 'node:assert/strict';
import {STORAGE_KEY, CHAPTERS, normalizeProgress, loadProgress, saveProgress} from '../src/progress.js';
import {quiz} from '../src/lessons.js';

const empty = () => ({completed: [], answers: {}});
function memoryStorage(initial = null) {
  const values = new Map(initial === null ? [] : [[STORAGE_KEY, initial]]);
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
}

test('progress: a first visit has empty progress and available storage', () => {
  assert.deepEqual(loadProgress(memoryStorage(), quiz), {data: empty(), available: true});
});

test('progress: saved chapter and quiz selections survive a JSON round trip', () => {
  const storage = memoryStorage();
  const progress = {completed: ['cnn', 'attention'], answers: {[quiz[0].id]: 2, [quiz[3].id]: 0}};
  assert.equal(saveProgress(storage, progress), true);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), progress);
  assert.deepEqual(loadProgress(storage, quiz), {data: progress, available: true});
});

test('progress: malformed or truncated JSON cannot prevent a fresh session', () => {
  for (const raw of ['{', '{"completed":', 'undefined', '[1,2,', 'plain text']) {
    assert.deepEqual(loadProgress(memoryStorage(raw), quiz), {data: empty(), available: false});
  }
});

test('progress: missing, denied and throwing storage reads fail safely', () => {
  for (const storage of [null, undefined, {}, {getItem() {throw new Error('SecurityError');}}]) {
    assert.deepEqual(loadProgress(storage, quiz), {data: empty(), available: false});
  }
});

test('progress: valid JSON of the wrong top-level type cannot become application state', () => {
  for (const value of [null, false, true, 7, 'cnn', [], ['cnn']]) {
    assert.deepEqual(normalizeProgress(value, quiz), empty());
    assert.deepEqual(loadProgress(memoryStorage(JSON.stringify(value)), quiz).data, empty());
  }
});

test('progress: chapter IDs are allowlisted and deduplicated without mutating saved data', () => {
  const input = {completed: ['cnn', 'cnn', 'unknown', null, 3, {}, 'transformer', '<img src=x onerror=alert(1)>']};
  const before = structuredClone(input);
  assert.deepEqual(normalizeProgress(input, quiz), {completed: ['cnn', 'transformer'], answers: {}});
  assert.deepEqual(input, before);
  for (const completed of ['cnn', null, false, {cnn: true}]) {
    assert.deepEqual(normalizeProgress({completed}, quiz).completed, []);
  }
});

test('progress: quiz answers must be integer indices within the current choices', () => {
  const question = quiz[0];
  for (const value of [-1, question.choices.length, 0.5, '0', true, null, {}, [], NaN, Infinity]) {
    assert.deepEqual(normalizeProgress({answers: {[question.id]: value}}, quiz).answers, {});
  }
  for (const value of [0, question.choices.length - 1]) {
    assert.deepEqual(normalizeProgress({answers: {[question.id]: value}}, quiz).answers, {[question.id]: value});
  }
});

test('progress: removed questions and stale out-of-range answers are discarded', () => {
  const currentQuiz = [{id: 'current', choices: ['yes', 'no']}];
  assert.deepEqual(normalizeProgress({answers: {removed: 0, current: 2}}, currentQuiz).answers, {});
  assert.deepEqual(normalizeProgress({answers: {removed: 0, current: 1}}, currentQuiz).answers, {current: 1});
});

test('progress: malicious JSON keys and markup never become chapter IDs or answer keys', () => {
  const malicious = JSON.parse('{"__proto__":{"atlasPolluted":true},"constructor":{"prototype":{"atlasPolluted":true}},"completed":["__proto__","constructor","<script>alert(1)</script>","cnn"],"answers":{"__proto__":{"atlasPolluted":true},"constructor":0,"<script>alert(1)</script>":0,"dot-product":1},"extra":"ignored"}');
  const result = normalizeProgress(malicious, quiz);
  assert.deepEqual(result, {completed: ['cnn'], answers: {'dot-product': 1}});
  assert.equal(Object.prototype.atlasPolluted, undefined);
  assert.equal({}.atlasPolluted, undefined);
  assert.deepEqual(Object.keys(result), ['completed', 'answers']);
});

test('progress: null or malformed answer containers do not invent selections', () => {
  for (const answers of [null, false, true, 1, 'all correct', [], [0, 1, 2]]) {
    assert.deepEqual(normalizeProgress({answers}, quiz).answers, {});
  }
});

test('progress: normalized collections are independent from the input and from other sessions', () => {
  const input = {completed: ['cnn'], answers: {[quiz[0].id]: 1}};
  const first = normalizeProgress(input, quiz);
  const second = normalizeProgress(input, quiz);
  first.completed.push('rnn');
  first.answers[quiz[0].id] = 0;
  assert.deepEqual(second, input);
  assert.notEqual(first.completed, input.completed);
  assert.notEqual(first.answers, input.answers);
});

test('progress: quota, security, missing storage and serialization errors are reported without throwing', () => {
  const throwing = {setItem() {throw new Error('QuotaExceededError');}};
  for (const storage of [throwing, null, undefined, {}]) assert.equal(saveProgress(storage, empty()), false);
  const circular = empty(); circular.self = circular;
  assert.equal(saveProgress(memoryStorage(), circular), false);
});

test('progress: every recognised chapter can be restored, and unknown metadata is discarded', () => {
  const data = {completed: [...CHAPTERS], answers: {}, exportedAt: '2026-01-01', app: 'Another app'};
  assert.deepEqual(loadProgress(memoryStorage(JSON.stringify(data)), quiz).data, {completed: [...CHAPTERS], answers: {}});
});

test('progress import: accepts versioned exports and discards unknown fields', async()=>{
  const {parseProgressImport}=await import('../src/progress.js');
  const qs=[{id:'q',choices:['a','b']}];
  const data=parseProgressImport(JSON.stringify({app:'Attention Atlas',version:1,completed:['cnn','unknown','cnn'],answers:{q:1,foreign:0},extra:'ignored'}),qs);
  assert.deepEqual(data,{completed:['cnn'],answers:{q:1}});
});
test('progress import: rejects other apps, oversized files, malformed JSON and unsupported versions',async()=>{
  const {parseProgressImport}=await import('../src/progress.js');
  for(const text of ['{','null','{}',JSON.stringify({app:'Attention Atlas',version:2,completed:[],answers:{}}),JSON.stringify({app:'Attention Atlas',version:1,completed:[],answers:[]})])assert.throws(()=>parseProgressImport(text));
  assert.throws(()=>parseProgressImport(' '.repeat(65537)),/64 KB/);
});
test('progress merge: older exports cannot erase correct answers; correct imported answers are restored',async()=>{
 const {mergeProgress}=await import('../src/progress.js');
 const qs=[{id:'a',choices:['x','y'],answer:1},{id:'b',choices:['x','y'],answer:0}];
 const current={completed:['cnn'],answers:{a:1,b:1}},incoming={completed:['rnn','cnn'],answers:{a:0,b:0}};
 assert.deepEqual(mergeProgress(current,incoming,qs),{completed:['cnn','rnn'],answers:{a:1,b:0}});
 assert.deepEqual(current,{completed:['cnn'],answers:{a:1,b:1}});
});

test('stale tabs preserve independent marks and do not resurrect progress after reset', async () => {
  const {commitProgress}=await import('../src/progress.js');
  const storage=memoryStorage(), first=empty(), second=empty();
  const one=commitProgress(storage,first,{completed:['cnn'],answers:{}},quiz);
  const two=commitProgress(storage,second,{completed:['rnn'],answers:{}},quiz);
  assert.deepEqual(two.data.completed,['cnn','rnn']);
  commitProgress(storage,two.data,empty(),quiz,{reset:true});
  const after=commitProgress(storage,one.data,{completed:['cnn','attention'],answers:{}},quiz);
  assert.deepEqual(after.data.completed,['attention']);
});

test('quiz retries are explicit deletions and imports preserve newly saved correct answers', async () => {
  const {commitProgress}=await import('../src/progress.js');
  const questions=[{id:'q',choices:['a','b'],answer:1}];
  const storage=memoryStorage();
  const correct=commitProgress(storage,empty(),{completed:[],answers:{q:1}},questions);
  const imported=commitProgress(storage,empty(),{completed:[],answers:{q:0}},questions,{preserveCorrect:true});
  assert.equal(imported.data.answers.q,1);
  const retry=commitProgress(storage,correct.data,empty(),questions);
  assert.deepEqual(retry.data.answers,{});
});

test('corrupt saved progress is preserved until an explicit reset and failed writes retain the session', async()=>{
  const {commitProgress}=await import('../src/progress.js');
  const desired={completed:['cnn'],answers:{}};
  const storage=memoryStorage('{');
  assert.deepEqual(commitProgress(storage,empty(),desired,quiz),{data:desired,available:false});
  assert.equal(storage.getItem(STORAGE_KEY),'{');
  assert.equal(commitProgress(storage,empty(),empty(),quiz,{reset:true}).available,true);
  storage.setItem=()=>{throw new Error('quota');};
  assert.deepEqual(commitProgress(storage,empty(),desired,quiz),{data:desired,available:false});
});

test('queued progress events use current storage, including reset, and ignore unrelated sources', async()=>{
  const {subscribeProgressChanges}=await import('../src/progress.js');
  const listeners=new Set(),target={addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)};
  const storage=memoryStorage();let current,failures=0;
  const stop=subscribeProgressChanges(target,storage,quiz,value=>{current=value;},()=>failures++);
  const send=(key,newValue,storageArea=storage)=>{for(const fn of listeners)fn({key,newValue,storageArea});};
  saveProgress(storage,{completed:['rnn'],answers:{}});
  send(STORAGE_KEY,JSON.stringify({completed:['cnn'],answers:{}}));
  assert.deepEqual(current.completed,['rnn']);
  saveProgress(storage,empty());send(null,null);assert.deepEqual(current,empty());
  saveProgress(storage,{completed:['cnn'],answers:{}});send('unrelated',null);send(STORAGE_KEY,null,{});assert.deepEqual(current,empty());
  storage.setItem(STORAGE_KEY,'{');send(STORAGE_KEY,'{}');assert.equal(failures,1);assert.deepEqual(current,empty());
  stop();saveProgress(storage,{completed:['rnn'],answers:{}});send(STORAGE_KEY,null);assert.deepEqual(current,empty());
});

test('an explicit import restores matching stale marks without reviving unrelated erased progress', async()=>{
  const {commitProgress,mergeProgress}=await import('../src/progress.js');
  const questions=[{id:'q',choices:['a','b'],answer:1},{id:'other',choices:['a','b'],answer:1}];
  const stale={completed:['cnn','rnn'],answers:{q:0,other:1}};
  const incoming={completed:['cnn'],answers:{q:0}};
  const storage=memoryStorage(JSON.stringify(empty()));
  const result=commitProgress(storage,stale,mergeProgress(stale,incoming,questions),questions,{preserveCorrect:true,imported:incoming});
  assert.deepEqual(result,{data:{completed:['cnn'],answers:{q:0}},available:true});
  saveProgress(storage,{completed:['attention'],answers:{q:1}});
  const preserved=commitProgress(storage,stale,mergeProgress(stale,incoming,questions),questions,{preserveCorrect:true,imported:incoming});
  assert.deepEqual(preserved.data,{completed:['attention','cnn'],answers:{q:1}});
});


test('revision plan prioritizes mistakes, then unanswered questions without changing saved answers', async () => {
  const { revisionPlan } = await import('../src/progress.js');
  const questions = [
    {id:'a', topic:'cnn', choices:['yes','no'], answer:0},
    {id:'b', topic:'rnn', choices:['yes','no'], answer:1},
    {id:'c', topic:'attention', choices:['yes','no'], answer:0},
    {id:'d', topic:'transformer', choices:['yes','no'], answer:1},
  ];
  const saved = { completed:[], answers:{b:0,c:0,d:1} };
  const before = JSON.stringify(saved);
  assert.deepEqual(revisionPlan(saved, questions).map(row => [row.id,row.index,row.status]),
    [['b',1,'incorrect'],['a',0,'unanswered']]);
  assert.equal(JSON.stringify(saved), before);
  assert.equal(revisionPlan({answers:{a:0,b:1,c:0,d:1}},questions).length,0);
  assert.deepEqual(revisionPlan(null,questions).map(row=>row.index),[0,1,2,3]);
  assert.equal(revisionPlan({answers:{a:99}},questions)[0].status,'unanswered');
  assert.deepEqual(revisionPlan({},[]),[]);
});
