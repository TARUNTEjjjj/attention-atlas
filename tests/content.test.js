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
  assert.equal(Number(answer('scaled-variance')), Math.sqrt(64 * 1));
  assert.equal(answer('softmax-saturation'), (Math.exp(8) / (Math.exp(8) + 3)).toFixed(3));
  assert.equal(Number(answer('head-dimension')), 512 / 8);
  const lrate = 512 ** -0.5 * Math.min(4000 ** -0.5, 4000 * 4000 ** -1.5);
  assert.equal(answer('warmup-peak'), `About ${(lrate * 1e4).toFixed(1)} × 10⁻⁴`);
  assert.equal(answer('ffn-parameters'), (512 * 2048 + 2048 + 2048 * 512 + 512).toLocaleString('en-US'));
  assert.equal(answer('path-length'), 'Self-attention');
});

test('content: worked numbers in the lessons agree with independent arithmetic', () => {
  const text = lessons.map(lesson => lesson.body).join('\n');
  const encoderAttention = 8 * 3 * 512 * 64 + 512 * 512, ffn = 512 * 2048 + 2048 + 2048 * 512 + 512, layerNorms = 2 * (512 + 512);
  const decoderLayer = 2 * encoderAttention + ffn + 3 * (512 + 512);
  for (const value of [encoderAttention, ffn, layerNorms, encoderAttention + ffn + layerNorms, decoderLayer, 50 ** 2 * 512, 50 * 512 ** 2]) {
    assert.ok(text.includes(value.toLocaleString('en-US')), `Lessons should show ${value.toLocaleString('en-US')}`);
  }
  assert.equal(4096 ** 2 * 512 / (4096 * 512 ** 2), 8);
  assert.ok(text.includes(`≈ ${(1 / Math.sqrt(2_048_000) * 1e4).toFixed(2)} × 10⁻⁴`));
  assert.ok(text.includes(`about ${(512 ** -0.5 * 16000 ** -0.5 * 1e4).toFixed(2)} × 10⁻⁴`));
  assert.ok(Math.abs(ffn / (encoderAttention + ffn + layerNorms) - 2 / 3) < 0.01, 'FFN share should be about two-thirds');
  // Table 1's O(n²·d) entry omits the projections; the lesson must say so next to the n < d comparison.
  assert.match(text, /projections add O\(n · d²\) more/);
});

test('content: every later-architecture edit in the Transformer lesson links a primary source', () => {
  const body = lessons.find(lesson => lesson.id === 'transformer').body;
  const map = body.slice(body.indexOf('After 2017'));
  for (const url of ['https://arxiv.org/abs/1810.04805', 'https://arxiv.org/abs/1801.10198', 'https://arxiv.org/abs/2002.04745', 'https://arxiv.org/abs/2104.09864', 'https://arxiv.org/abs/2205.14135']) {
    assert.ok(map.includes(`href="${url}"`), `After-2017 map should link ${url}`);
    assert.ok(sources.some(source => source.url === url), `${url} should also be in the source list`);
  }
});

test('content: advertised counts match the page, the data and the README', async () => {
  const {learningContent} = await import('../src/learning-tools.js');
  const readme = await readFile(new URL('README.md', root), 'utf8');
  const {glossary, experiments} = learningContent();
  const labMounts = attributes(html, 'class').filter(name => name.split(/\s+/).includes('lab')).length;
  assert.match(html, new RegExp(`<span>${String(labMounts).padStart(2, '0')} interactive labs</span>`));
  const words = {6: 'six', 7: 'seven', 13: 'thirteen', 20: 'twenty', 25: 'twenty-five'};
  assert.ok(html.includes(`All ${words[labMounts]} lab calculations run locally`));
  assert.ok(readme.includes(`${words[quiz.length]} explained checkpoints`), 'README checkpoint count');
  assert.ok(readme.includes(`${words[glossary.length]} glossary concepts`), 'README glossary count');
  assert.ok(readme.includes(`${words[experiments.length]} guided experiments`), 'README experiment count');
  for (const experiment of experiments) assert.ok(CHAPTERS.includes(experiment.chapter), `Unknown chapter ${experiment.chapter}`);
  assert.equal(new Set(experiments.map(experiment => experiment.number)).size, experiments.length);
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
