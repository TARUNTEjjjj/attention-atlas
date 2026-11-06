import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const scripts = (await readdir(new URL('src/', root))).filter(name => name.endsWith('.js')).sort().map(name => `src/${name}`);
const markupSources = await Promise.all(['index.html', ...scripts].map(async path => ({path, text: await read(path)})));

// In a grid container every element child, and every run of non-blank text between them, is a separate grid item.
function gridItems(html) {
  const items = [];
  let depth = 0, text = '';
  for (const token of html.match(/<\/?[a-z][^>]*>|[^<]+/gi) ?? []) {
    if (token.startsWith('</')) { depth = Math.max(0, depth - 1); continue; }
    if (token.startsWith('<')) {
      if (depth === 0) { if (text.trim()) items.push(text.trim()); text = ''; items.push(token); }
      if (!/^<(?:br|img|wbr|input)\b/i.test(token) && !token.endsWith('/>')) depth++;
      continue;
    }
    if (depth === 0) text += token;
  }
  if (text.trim()) items.push(text.trim());
  return items;
}

test('layout: each .control caption is a single grid item, so a subscript stays on the caption line', () => {
  // .control labels use display:grid. A bare <sub> beside the caption text becomes its own row ("Input weight w" / "x").
  let checked = 0;
  for (const {path, text} of markupSources) {
    for (const [, attributes, caption] of text.matchAll(/<label\b([^>]*)>([\s\S]*?)<(?:output|input|select|textarea)\b/g)) {
      if (!(/\bclass="([^"]*)"/.exec(attributes)?.[1].split(/\s+/) ?? []).includes('control')) continue;
      checked++;
      assert.equal(gridItems(caption).length, 1, `${path}: control caption ${JSON.stringify(caption.trim())} is split across grid rows`);
    }
  }
  assert.ok(checked >= 10, `Expected to inspect the lab control labels; found ${checked}`);
});
