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
