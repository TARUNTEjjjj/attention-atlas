import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {lessons, quiz, sources} from '../src/lessons.js';
import {CHAPTERS} from '../src/progress.js';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const guide = await readFile(new URL('docs/LEARNING_GUIDE.md', root), 'utf8');
const attributes = (source, name) => [...source.matchAll(new RegExp(`\\b${name}="([^"]*)"`, 'g'))].map(match => match[1]);

test('content: every chapter has one matching lesson, section, completion button and lesson mount', () => {
  assert.deepEqual(lessons.map(lesson => lesson.id), CHAPTERS);
  const ids = attributes(html, 'id');
  const mounts = attributes(html, 'data-lesson');
  const completes = attributes(html, 'data-complete');
  assert.equal(new Set(ids).size, ids.length, 'Static page IDs must be unique');
  for (const lesson of lessons) {
    assert.equal(ids.filter(id => id === lesson.id).length, 1, `Missing section for ${lesson.id}`);
    assert.equal(mounts.filter(id => id === lesson.id).length, 1, `Missing lesson mount for ${lesson.id}`);
    assert.equal(completes.filter(id => id === lesson.id).length, 1, `Missing progress button for ${lesson.id}`);
    for (const key of ['title', 'kicker', 'summary', 'body']) assert.ok(lesson[key]?.trim(), `${lesson.id}.${key} must be present`);
  }
});

test('content: static navigation points to real sections, and local assets exist', async () => {
  const ids = new Set(attributes(html, 'id'));
  for (const href of attributes(html, 'href').filter(href => href.startsWith('#'))) {
    assert.ok(ids.has(href.slice(1)), `Broken section link ${href}`);
  }
  const paths = [...attributes(html, 'href'), ...attributes(html, 'src')].filter(path => path.startsWith('/'));
  assert.ok(paths.length > 0);
  for (const path of paths) {
    assert.ok(!path.includes('..'), `Unexpected traversal path ${path}`);
    await access(new URL(path.slice(1), root));
  }
});

test('content: checkpoints have stable unique IDs, valid answers and meaningful feedback', () => {
  assert.ok(quiz.length >= 12);
  assert.equal(new Set(quiz.map(question => question.id)).size, quiz.length);
  for (const q of quiz) {
    assert.match(q.id, /^[a-z][a-z0-9-]+$/);
    assert.ok(CHAPTERS.includes(q.topic), `Unknown topic ${q.topic}`);
    assert.ok(q.question.length > 20);
    assert.ok(q.choices.length >= 2);
    assert.equal(new Set(q.choices).size, q.choices.length, `Duplicate choices in ${q.id}`);
    assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.choices.length);
    assert.ok(q.explanation.length > 50, `Explanation too short for ${q.id}`);
  }
  for (const topic of ['foundations', 'cnn', 'rnn', 'attention', 'transformer']) {
    assert.ok(quiz.some(q => q.topic === topic), `No practice for ${topic}`);
  }
});

test('content: numerical answer keys agree with independent arithmetic', () => {
  const answer = id => {const q = quiz.find(q => q.id === id); assert.ok(q, `Missing ${id}`); return q.choices[q.answer];};
  assert.equal(Number(answer('dot-product')), 1 * 3 + 2 * -1);
  const side = Math.floor((5 - 3) / 2) + 1;
  assert.equal(answer('cnn-shape'), `${side} × ${side}`);
  assert.equal(Number(answer('cnn-patch')), 3 * (1 + 0 - 1));
  assert.equal(Number(answer('cnn-sharing')), 4 * (2 * 3 * 3 + 1));
  assert.equal(Number(answer('rnn-zero')), Math.tanh(0));
  assert.equal(Number(answer('rnn-gradient')), 0.5 ** 3);
  assert.equal(Number(answer('attention-average')), (2 + 10) / 2);
  assert.equal(answer('attention-shape'), '3 × 5');
  const n = 7;
  assert.equal(Number(answer('quadratic-scores')), ((2 * n) ** 2) / n ** 2);
});

test('content: research references use HTTPS and the guide retains the original source links', () => {
  assert.ok(sources.length >= 4);
  assert.equal(new Set(sources.map(s => s.url)).size, sources.length);
  const officialHosts = new Set(['arxiv.org', 'docs.pytorch.org', 'aclanthology.org']);
  for (const source of sources) {
    const url = new URL(source.url);
    assert.equal(url.protocol, 'https:');
    assert.ok(officialHosts.has(url.hostname), `Review a new source domain before adding ${url.hostname}`);
    assert.ok(source.title.length > 10 && source.note.length > 30);
    assert.ok(guide.includes(source.url), `Guide missing ${source.url}`);
  }
});

test('content: authored rich text cannot inject active HTML or unsafe links', () => {
  const prose = lessons.map(l => l.body).join('\n');
  assert.doesNotMatch(prose, /<\s*(script|iframe|object|embed)\b|\bon[a-z]+\s*=|javascript:|data:text\/html/i);
  for (const tag of [...prose.matchAll(/<a\b[^>]*>/g)].map(match => match[0])) {
    const href = attributes(tag, 'href')[0];
    assert.equal(new URL(href).protocol, 'https:');
    if (attributes(tag, 'target')[0] === '_blank') {
      const rel = attributes(tag, 'rel')[0]?.split(/\s+/) ?? [];
      assert.ok(rel.includes('noopener') && rel.includes('noreferrer'));
    }
  }
  // The quiz renderer uses authored strings as HTML. Keep questions and choices plain text.
  for (const q of quiz) {
    for (const text of [q.question, q.explanation, ...q.choices]) assert.doesNotMatch(text, /<[^>]*>/);
  }
});
