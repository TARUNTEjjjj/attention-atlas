import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const scripts = (await readdir(new URL('src/', root))).filter(name => name.endsWith('.js')).sort().map(name => `src/${name}`);
const markupSources = await Promise.all(['index.html', ...scripts].map(async path => ({path, text: await read(path)})));
const html = markupSources[0].text;
const stylesheets = await Promise.all([...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="\/([^"]+)"/g)].map(async ([, path]) => ({path, text: await read(path)})));

// Innermost "selector{declarations}" blocks, including rules nested in @media.
const cssRules = css => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({selector: selector.trim(), body}));

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

test('layout: nothing on the page defers rendering, so chapter links land just below the sticky header', () => {
  // content-visibility:auto/hidden lays an element out at its contain-intrinsic-size estimate until it first renders.
  // A chapter link scrolls using those estimates; the sections then render at their real heights and push the target
  // down. "Test yourself" left #practice about 1,000px below the fold, under the Transformer chapter.
  assert.ok(stylesheets.some(sheet => sheet.path === 'styles.css'), 'index.html must link styles.css');
  for (const {path, text} of stylesheets) {
    for (const {selector, body} of cssRules(text)) {
      assert.doesNotMatch(body, /content-visibility\s*:\s*(?:auto|hidden)/, `${path}: "${selector}" defers rendering, which moves in-page link targets after the jump`);
    }
  }
});
