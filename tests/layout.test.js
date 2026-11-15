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

// The stylesheets a page links, each href resolved against the page as a browser resolves it.
const linkedStylesheets = (page, text) => Promise.all([...text.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g)].map(async ([, href]) => {
  const path = new URL(href, new URL(page, 'https://atlas.invalid/')).pathname.slice(1);
  return {path, text: await read(path)};
}));

// Every innermost "selector{declarations}" block, with the @media condition around it ('' at the top level).
function cssBlocks(css) {
  const blocks = [], open = [];
  let text = '';
  for (const char of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (char === '{') { open.push(text.trim()); text = ''; continue; }
    if (char !== '}') { text += char; continue; }
    const selector = open.pop();
    if (!selector.startsWith('@')) {
      const declarations = Object.fromEntries(text.split(';').filter(part => part.includes(':')).map(part => [part.slice(0, part.indexOf(':')).trim(), part.slice(part.indexOf(':') + 1).trim()]));
      blocks.push({media: open.join(' ').replace(/\s+/g, ''), selector, declarations});
    }
    text = '';
  }
  return blocks;
}
const blocks = stylesheets.flatMap(({path, text}) => cssBlocks(text).map(block => ({path, ...block})));
const px = value => Number(/^([\d.]+)px$/.exec(value)[1]);

test('layout: the CNN lab drops to one column before its image and filter stop fitting side by side', async () => {
  // Below 720px the CNN grid is "1fr 1fr" over fixed-size cells, and its tracks cannot shrink below the matrices.
  // From 391 to 401px .lab{overflow:hidden} cut off the filter's right column and the feature-map size ("3 ×"),
  // 7.3px on a 393px iPhone; up to 421px the grid ran into the lab body's right padding.
  const styles = blocks.filter(block => block.path === 'styles.css');
  const value = (media, selector, property) => styles.filter(block => block.media === media && block.selector.split(',').includes(selector)).map(block => block.declarations[property]).filter(Boolean).at(-1);
  const phone = '@media(max-width:720px)';
  const visual = await read('src/visual-labs.js');
  const [image, filter] = ['pixels', 'kernel-grid'].map(id => Number(new RegExp(`id="${id}"[^>]*grid-template-columns:repeat\\((\\d+),`).exec(visual)[1]));
  const cellGap = px(value('', '.matrix', 'gap'));
  const needed = image * px(value(phone, '.matrix-cell', 'width')) + (image - 1) * cellGap
    + px(value(phone, '.experiment-grid', 'gap').split(' ').at(-1))
    + filter * px(value(phone, '.matrix.kernel .matrix-cell', 'width')) + (filter - 1) * cellGap;
  const margin = Number(/^(\d+)%$/.exec(value('@media(max-width:1400px)', '.section', 'margin-left'))[1]) / 100;
  const frame = 2 * px(value('', '.lab', 'border').split(' ')[0]) + 2 * px(value(phone, '.lab-body', 'padding'));
  const oneColumn = styles.find(block => block.selector === '.experiment-grid' && block.declarations['grid-template-columns'] === '1fr');
  const breakpoint = Number(/^@media\(max-width:(\d+)px\)$/.exec(oneColumn.media)[1]);
  const room = (breakpoint + 1) * (1 - 2 * margin) - frame;
  assert.ok(room >= needed, `At ${breakpoint + 1}px the two CNN columns need ${needed}px, but the lab body has ${room.toFixed(1)}px`);
});

test('layout: on phones every field that opens a keyboard or a picker is at least 16px, so iPhone Safari does not zoom', async () => {
  // iPhone Safari zooms the page by 16 / font-size when a smaller field gets focus, and stays zoomed after blur.
  // The fields were 11–13px on phones (14px in landscape): following "Enter six zeros" left the RNN lab cropped.
  // A single !important rule outranks each component's own font size, whatever its specificity.
  // The resource library, which the mobile chapter bar links as Resources, does not load styles.css: its search field
  // and selects were 13–14px until its own stylesheet got the rule. Each page's floor covers its own phone layout.
  for (const {page, phone} of [{page: 'index.html', phone: 720}, {page: 'resources/index.html', phone: 680}]) {
    const pageBlocks = (await linkedStylesheets(page, await read(page))).flatMap(({path, text}) => cssBlocks(text).map(block => ({path, ...block})));
    assert.ok(pageBlocks.some(block => block.media === `@media(max-width:${phone}px)`), `${page}: expected its phone layout from ${phone}px down`);
    const floors = pageBlocks.filter(block => /^16px\s*!important$/.test(block.declarations['font-size'] ?? ''));
    assert.equal(floors.length, 1, `${page}: expected one 16px !important font-size rule for form fields`);
    const [floor] = floors;
    // Every width that uses the phone layout, and touch screens: phones in landscape are wider than that.
    assert.ok(Number(/\(max-width:(\d+)px\)/.exec(floor.media)?.[1]) >= phone, `${page}: ${floor.media} misses phone-width layouts`);
    assert.match(floor.media, /\(pointer:coarse\)/, `${page}: phones in landscape need the floor too`);
    const selectors = floor.selector.split(',').map(selector => selector.trim());
    assert.ok(selectors.includes('select'), `${page}: a select opens a picker and zooms too`);
    const inputs = selectors.find(selector => /^input(?::not\(\[type=[a-z]+\]\))*$/.test(selector));
    assert.ok(inputs, `${page}: ${floor.selector} must cover every input type except those without a keyboard`);
    for (const [, type] of inputs.matchAll(/\[type=([a-z]+)\]/g)) {
      assert.ok(['range', 'checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'image', 'color', 'hidden'].includes(type), `${page}: type=${type} opens a keyboard but is left out`);
    }
    for (const block of pageBlocks) {
      if (block === floor) continue;
      for (const [property, value] of Object.entries(block.declarations)) {
        if (/^font(?:-size)?$/.test(property)) assert.doesNotMatch(value, /!important/, `${block.path}: "${block.selector}" {${property}:${value}} would outrank the 16px floor`);
      }
    }
  }
});
