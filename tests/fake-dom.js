/**
 * A small DOM stand-in, so the labs and app.js can run in Node, which has no DOM, and the repo has no dependencies.
 * It parses HTML, matches the selectors the site uses (tags, #id, .class, [attr], [attr="value"] and the prefix, suffix
 * and substring forms ^=, $= and *=, joined by descendant or child combinators, in comma lists), runs capture listeners
 * and bubbles events, and tracks focus. It does no layout and applies no CSS. An unsupported selector throws, so a test
 * cannot silently match nothing. A node is safe to hand to assert: see FakeNode.
 */
const HTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
const decode = text => text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, name) => name[0] !== '#' ? ENTITIES[name] ?? match
  : String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))));
const escape = (text, quote) => text.replace(/&/g, '&amp;').replace(quote ? /"/g : /[<>]/g, c => ({'"': '&quot;', '<': '&lt;', '>': '&gt;'})[c]);
const kebab = key => key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);

/** The text a browser renders before author CSS: [hidden] elements and the body of a closed <details> (all but its <summary>) are left out. */
export function shownText(node) {
  if (node instanceof FakeText) return node.data;
  if (node instanceof FakeElement && node.hasAttribute('hidden')) return '';
  const closed = node.localName === 'details' && !node.open;
  return node.childNodes.filter(child => !closed || child.localName === 'summary').map(shownText).join('');
}

export class FakeEvent {
  constructor(type, {bubbles = false, key} = {}) {
    Object.assign(this, {type, bubbles, key, target: null, currentTarget: null, defaultPrevented: false, stopped: false});
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
}

let serial = 0;
class FakeNode {
  constructor(ownerDocument) {
    // A failed assertion prints both of its values with every enumerable property, to any depth. Through parentNode,
    // childNodes or ownerDocument one node is the whole document, printed again from each node it reaches: the test run
    // then hangs and runs out of memory instead of failing. So the links into the tree are not enumerable, and a node
    // prints as its tag, attributes and field state. The serial number keeps two look-alike nodes from being deep-equal.
    for (const [name, value] of Object.entries({ownerDocument, parentNode: null, childNodes: [], listeners: new Map(), captureListeners: new Map()})) {
      Object.defineProperty(this, name, {value, writable: true});
    }
    this.serial = ++serial;
  }
  get parentElement() { return this.parentNode instanceof FakeElement ? this.parentNode : null; }
  get children() { return this.childNodes.filter(node => node instanceof FakeElement); }
  get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(String(value ?? '')); }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  prepend(...nodes) { const first = this.childNodes[0] ?? null; for (const node of nodes) this.insertBefore(node, first); }
  insertBefore(node, reference) {
    if (typeof node === 'string') node = new FakeText(this.ownerDocument, node);
    node.remove();
    const index = reference ? this.childNodes.indexOf(reference) : -1;
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, node);
    node.parentNode = this;
    return node;
  }
  remove() {
    const {parentNode: parent, ownerDocument: document} = this;
    if (!parent) return;
    // As in Chrome, removing the focused element (or its ancestor) hands focus back to <body>.
    if (document.activeElement && this.contains(document.activeElement)) document.activeElement = document.body;
    parent.childNodes.splice(parent.childNodes.indexOf(this), 1);
    this.parentNode = null;
  }
  replaceChildren(...nodes) { for (const child of [...this.childNodes]) child.remove(); this.append(...nodes); }
  contains(node) { for (let current = node; current; current = current.parentNode) if (current === this) return true; return false; }
  * descendants() { for (const child of this.children) { yield child; yield* child.descendants(); } }
  querySelectorAll(selector) { const alternatives = parseSelector(selector); return [...this.descendants()].filter(element => alternatives.some(parts => matches(element, parts))); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  /** The third argument is `true` or {capture: true} for a capture listener, as in a browser; {signal} removes the listener on abort. */
  addEventListener(type, handler, options = {}) {
    const capture = options === true || options?.capture === true, signal = options?.signal;
    if (signal?.aborted) return;
    const listeners = capture ? this.captureListeners : this.listeners;
    listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    signal?.addEventListener('abort', () => this.removeEventListener(type, handler, capture));
  }
  removeEventListener(type, handler, options = {}) {
    const listeners = options === true || options?.capture === true ? this.captureListeners : this.listeners;
    listeners.set(type, (listeners.get(type) ?? []).filter(h => h !== handler));
  }
  /** Unlike a browser, an exception thrown by a listener propagates, so the test that triggered it fails. */
  dispatchEvent(event) {
    event.target = this;
    const path = [];
    for (let node = this; node; node = node.parentNode) path.push(node);
    const run = (node, listeners) => {
      event.currentTarget = node;
      for (const handler of listeners.get(event.type) ?? []) handler.call(node, event);
      return !event.stopped;
    };
    // Capture listeners run from the document down to the target, whether or not the event bubbles. Then the target's
    // own listeners run and, for a bubbling event, its ancestors' on the way back up.
    if (path.toReversed().every(node => run(node, node.captureListeners))) (event.bubbles ? path : [this]).every(node => run(node, node.listeners));
    event.currentTarget = null;
    return !event.defaultPrevented;
  }
}

class FakeText extends FakeNode {
  constructor(ownerDocument, data) { super(ownerDocument); this.data = String(data); }
  get textContent() { return this.data; }
  set textContent(value) { this.data = String(value); }
}

class FakeElement extends FakeNode {
  constructor(ownerDocument, name, namespace = HTML) {
    super(ownerDocument);
    const html = namespace === HTML;
    Object.assign(this, {namespaceURI: namespace, localName: html ? name.toLowerCase() : name, attributeMap: new Map(), style: {}});
    this.tagName = html ? this.localName.toUpperCase() : name;
  }
  getAttribute(name) { return this.attributeMap.get(name) ?? null; }
  setAttribute(name, value) { this.attributeMap.set(name, String(value)); }
  removeAttribute(name) { this.attributeMap.delete(name); }
  hasAttribute(name) { return this.attributeMap.has(name); }
  get classList() {
    const element = this, list = () => element.className.split(/\s+/).filter(Boolean);
    return {
      contains: name => list().includes(name),
      add: (...names) => { element.className = [...new Set([...list(), ...names])].join(' '); },
      remove: (...names) => { element.className = list().filter(name => !names.includes(name)).join(' '); },
      toggle(name, force = !list().includes(name)) { force ? this.add(name) : this.remove(name); return force; },
    };
  }
  get dataset() {
    return new Proxy({}, {
      get: (_, key) => typeof key === 'string' ? this.getAttribute(`data-${kebab(key)}`) ?? undefined : undefined,
      set: (_, key, value) => { this.setAttribute(`data-${kebab(key)}`, value); return true; },
      has: (_, key) => this.hasAttribute(`data-${kebab(key)}`),
    });
  }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(value) {
    value ? this.setAttribute('disabled', '') : this.removeAttribute('disabled');
    // Chrome's focus fixup: a focused control that becomes disabled loses focus to <body>.
    if (value && this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
  }
  get value() {
    if (this.localName === 'select') {
      const option = this.selectedOption;
      return option ? option.getAttribute('value') ?? option.textContent : '';
    }
    return this.dirtyValue ?? this.getAttribute('value') ?? '';
  }
  set value(value) {
    if (this.localName === 'select') this.selectedOption = this.querySelectorAll('option').find(option => (option.getAttribute('value') ?? option.textContent) === String(value)) ?? null;
    else this.dirtyValue = String(value);
  }
  get selectedOption() {
    const options = this.querySelectorAll('option');
    return this.chosen && options.includes(this.chosen) ? this.chosen : options.find(option => option.hasAttribute('selected')) ?? options[0] ?? null;
  }
  set selectedOption(option) { this.chosen = option; }
  get checked() { return this.dirtyChecked ?? this.hasAttribute('checked'); }
  set checked(value) { this.dirtyChecked = Boolean(value); }
  get innerHTML() { return serialize(this); }
  set innerHTML(html) { this.replaceChildren(); parseInto(this, String(html)); }
  matches(selector) { return parseSelector(selector).some(parts => matches(this, parts)); }
  closest(selector) { for (let element = this; element; element = element.parentElement) if (element.matches(selector)) return element; return null; }
  get focusable() {
    if (['button', 'input', 'select', 'textarea'].includes(this.localName)) return !this.disabled;
    return (this.localName === 'a' && this.hasAttribute('href')) || this.hasAttribute('tabindex');
  }
  focus() { if (this.focusable && this.ownerDocument.contains(this)) this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  click() { if (!this.disabled) this.dispatchEvent(new FakeEvent('click', {bubbles: true})); }
}
// Reflected attributes the site reads or writes as properties.
for (const [property, attribute] of [['id', 'id'], ['className', 'class'], ['type', 'type'], ['href', 'href'], ['htmlFor', 'for'], ['placeholder', 'placeholder'], ['autocomplete', 'autocomplete'], ['scope', 'scope'], ['download', 'download'], ['maxLength', 'maxlength'], ['spellcheck', 'spellcheck']]) {
  Object.defineProperty(FakeElement.prototype, property, {get() { return this.getAttribute(attribute) ?? ''; }, set(value) { this.setAttribute(attribute, value); }});
}
for (const property of ['hidden', 'open']) {
  Object.defineProperty(FakeElement.prototype, property, {get() { return this.hasAttribute(property); }, set(value) { value ? this.setAttribute(property, '') : this.removeAttribute(property); }});
}

export class FakeDocument extends FakeNode {
  constructor(html) {
    super(null);
    this.ownerDocument = this;
    parseInto(this, html);
    this.documentElement = this.children[0];
    this.body = this.querySelector('body');
    this.activeElement = this.body;
  }
  createElement(name) { return new FakeElement(this, name); }
  createElementNS(namespace, name) { return new FakeElement(this, name, namespace); }
  getElementById(id) { return [...this.descendants()].find(element => element.id === id) ?? null; }
}

function parseInto(parent, html) {
  const document = parent.ownerDocument, stack = [parent];
  const tokens = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|[^<]+|</g;
  for (const [text, closing, opening, attributes, selfClosing] of html.matchAll(tokens)) {
    const top = stack.at(-1);
    if (closing) {
      const index = stack.findLastIndex((node, i) => i > 0 && node.localName === closing.toLowerCase());
      if (index > 0) stack.length = index;
    } else if (opening) {
      const namespace = opening.toLowerCase() === 'svg' || top.namespaceURI === SVG ? SVG : HTML;
      const element = new FakeElement(document, opening, namespace);
      for (const [, name, double, single, bare] of attributes.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
        element.attributeMap.set(namespace === HTML ? name.toLowerCase() : name, decode(double ?? single ?? bare ?? ''));
      }
      top.append(element);
      if (!selfClosing && !VOID.has(element.localName)) stack.push(element);
    } else if (!text.startsWith('<!')) top.append(decode(text));
  }
}

function serialize(node) {
  return node.childNodes.map(child => {
    if (child instanceof FakeText) return escape(child.data, false);
    const attributes = [...child.attributeMap].map(([name, value]) => ` ${name}="${escape(value, true)}"`).join('');
    return `<${child.localName}${attributes}>${VOID.has(child.localName) ? '' : `${serialize(child)}</${child.localName}>`}`;
  }).join('');
}

const selectorCache = new Map();
/** "a b, c > d" → [[{combinator, compound}, …], …], one array per comma alternative. */
function parseSelector(selector) {
  if (selectorCache.has(selector)) return selectorCache.get(selector);
  const alternatives = [];
  let parts = [], compound = '', combinator = ' ', depth = 0, quote = null;
  const finish = () => { if (compound) { parts.push({combinator, compound: parseCompound(compound, selector)}); compound = ''; combinator = ' '; } };
  for (const char of `${selector},`) {
    if (quote) { compound += char; if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === '[') depth++;
    else if (char === ']') depth--;
    else if (depth === 0 && (char === ',' || char === '>' || /\s/.test(char))) {
      finish();
      if (char === '>') combinator = '>';
      if (char === ',') { if (!parts.length) throw new Error(`Unsupported selector: ${selector}`); alternatives.push(parts); parts = []; }
      continue;
    }
    compound += char;
  }
  selectorCache.set(selector, alternatives);
  return alternatives;
}
function parseCompound(text, selector) {
  const piece = /#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:([$^*]?)=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*)?\]/gy;
  const tag = /^[a-zA-Z][\w-]*|^\*/.exec(text)?.[0] ?? '*';
  const result = {tag: tag.toLowerCase(), id: null, classes: [], attributes: []};
  piece.lastIndex = tag === '*' && text[0] !== '*' ? 0 : tag.length;
  while (piece.lastIndex < text.length) {
    const match = piece.exec(text);
    if (!match) throw new Error(`Unsupported selector: ${selector}`);
    const [, id, className, name, operator, double, single, bare] = match;
    if (id) result.id = id;
    else if (className) result.classes.push(className);
    else result.attributes.push({name, operator, value: double ?? single ?? bare});
  }
  return result;
}
function matchesCompound(element, {tag, id, classes, attributes}) {
  if (tag !== '*' && element.localName.toLowerCase() !== tag) return false;
  if (id !== null && element.id !== id) return false;
  const own = element.className.split(/\s+/);
  // [a="v"] is the whole value; [a^="v"], [a$="v"] and [a*="v"] are its start, its end and any part (never an empty v).
  const holds = (actual, operator, value) => operator === '' ? actual === value
    : value !== '' && (operator === '^' ? actual.startsWith(value) : operator === '$' ? actual.endsWith(value) : actual.includes(value));
  return classes.every(name => own.includes(name)) && attributes.every(({name, operator, value}) => element.hasAttribute(name) && (value === undefined || holds(element.getAttribute(name), operator, value)));
}
function matches(element, parts, index = parts.length - 1) {
  if (!matchesCompound(element, parts[index].compound)) return false;
  if (index === 0) return true;
  if (parts[index].combinator === '>') return Boolean(element.parentElement) && matches(element.parentElement, parts, index - 1);
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) if (matches(ancestor, parts, index - 1)) return true;
  return false;
}
