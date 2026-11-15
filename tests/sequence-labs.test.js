import test from 'node:test';
import assert from 'node:assert/strict';
import {mountRNN} from '../src/sequence-labs.js';

// mountRNN uses only a few DOM features, so a small stand-in replaces the browser. querySelector returns one
// stable element per selector instead of parsing the lab's markup; the state buttons the lab creates are found
// among their parent's children, and their clicks bubble to it. Focus follows the browser rule the step buttons
// depend on: an element that is disabled or removed while focused hands focus back to <body>.
class FakeElement {
  #disabled = false;
  constructor(tag) {
    Object.assign(this, {tagName: tag.toUpperCase(), parentNode: null, children: [], dataset: {}, attributes: new Map(), listeners: new Map(), bySelector: new Map(), innerHTML: '', textContent: '', className: '', type: '', value: ''});
  }
  get disabled() { return this.#disabled; }
  set disabled(value) {
    this.#disabled = Boolean(value);
    if (this.#disabled && document.activeElement === this) document.activeElement = document.body;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, handler) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]); }
  dispatch(type) {
    for (let node = this; node; node = node.parentNode) for (const handler of node.listeners.get(type) ?? []) handler({type, target: this, currentTarget: node});
  }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() { if (!this.disabled) document.activeElement = this; }
  closest(selector) { return selector === 'button[data-index]' && this.tagName === 'BUTTON' && 'index' in this.dataset ? this : null; }
  append(...nodes) {
    for (const node of nodes) node.parentNode = this;
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    if (this.children.includes(document.activeElement)) document.activeElement = document.body;
    for (const node of this.children) node.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }
  querySelector(selector) {
    const index = /^button\[data-index="(\d+)"\]$/.exec(selector)?.[1];
    if (index !== undefined) return this.children.find(child => child.dataset.index === index) ?? null;
    if (!this.bySelector.has(selector)) this.bySelector.set(selector, new FakeElement(selector.includes('data-action') ? 'button' : 'div'));
    return this.bySelector.get(selector);
  }
}
const body = new FakeElement('body');
globalThis.document = {body, activeElement: body, createElement: tag => new FakeElement(tag)};

const stripTags = html => html.replace(/<[^>]+>/g, '');
function mountLab() {
  const root = new FakeElement('section');
  mountRNN(root);
  const id = /id="(rnn-\d+)-inputs"/.exec(root.innerHTML)[1];
  const $ = selector => root.querySelector(selector);
  const strip = $('.sequence-strip');
  const working = () => $('.rnn-working').innerHTML;
  return {
    root,
    action: name => $(`[data-action="${name}"]`),
    state: index => strip.querySelector(`button[data-index="${index}"]`),
    type(text) {
      const field = $(`#${id}-inputs`);
      field.value = text;
      field.dispatch('input');
    },
    slide(name, value) {
      const slider = $(`#${id}-${name}`);
      slider.value = String(value);
      slider.dispatch('input');
    },
    // Every number the lab prints: the state buttons (text and accessible name) and the worked calculation.
    text: () => stripTags([...strip.children.flatMap(node => [node.innerHTML, node.getAttribute('aria-label') ?? '']), working()].join('\n')),
    explanation: () => stripTags(/<div class="sequence-sensitivity">[\s\S]*?<p>([\s\S]*?)<\/p>/.exec(working())[1]),
    gradient: () => /∂h₀<\/span><strong>([^<]+)<\/strong>/.exec(working())[1],
    product: () => /<p class="sequence-product">([^<]+)<\/p>/.exec(working())[1],
  };
}

// toFixed keeps the sign of a negative value that rounds to zero, which would print "-0.0000" or "-0.000".
const signedZero = /-0\.0+(?!\d)/;

test('RNN lab: a value that rounds to zero is shown as 0.0000, never as a signed zero', () => {
  const tiny = mountLab();
  tiny.type('-0.00003'); // h₁ = tanh(0.8 × −0.00003) ≈ −2.4e-5
  assert.match(tiny.text(), /h1 = 0\.0000/);
  assert.doesNotMatch(tiny.text(), signedZero);

  const saturated = mountLab(); // both chain-rule factors are about −1.5e-4
  saturated.slide('wx', 1);
  saturated.slide('wh', -0.5);
  saturated.type('5, 5');
  saturated.action('all').click();
  assert.equal(saturated.product(), '0.000 × 0.000 ≈ 2.240e-8');

  // Every slider setting and every revealed step, for inputs that saturate tanh or nearly cancel.
  for (const sequence of ['5, 5', '4, 4, 4, 4', '0.5, 0.5, 0.5, 0.5']) {
    const lab = mountLab();
    lab.type(sequence);
    lab.action('all').click();
    for (let x = -20; x <= 20; x++) {
      for (let h = -20; h <= 20; h++) {
        lab.slide('wx', x / 10);
        lab.slide('wh', h / 10);
        for (let index = 0; index < sequence.split(',').length; index++) {
          lab.state(index).click();
          assert.doesNotMatch(lab.text(), signedZero, `${sequence} with wₓ = ${x / 10}, wₕ = ${h / 10}, step ${index + 1}`);
        }
      }
    }
  }
});

test('RNN lab: with wₕ = 0 the panel says h₀ has no effect, not that its effect has shrunk', () => {
  const lab = mountLab();
  lab.slide('wh', 0);
  lab.action('all').click();
  for (let index = 0; index < 4; index++) {
    lab.state(index).click();
    assert.equal(lab.gradient(), '0.000e+0');
    assert.match(lab.explanation(), /^The derivative is exactly zero/);
    assert.doesNotMatch(lab.explanation(), /barely|shrunk/);
  }
  lab.slide('wh', 0.1); // tiny but nonzero: the sensitivity really has shrunk
  assert.equal(lab.gradient(), '1.957e-5');
  assert.match(lab.explanation(), /barely affects this state/);
});

test('RNN lab: a step button that disables itself hands keyboard focus to the state it revealed', () => {
  const all = mountLab();
  all.action('all').focus();
  all.action('all').click();
  assert.equal(all.action('all').disabled, true);
  assert.equal(document.activeElement, all.state(3), 'Reveal all steps should focus the last state, not <body>');

  const next = mountLab();
  const step = next.action('step');
  step.focus();
  for (const shown of [2, 3]) {
    step.click();
    assert.equal(document.activeElement, step, `Next step keeps focus while it stays enabled (step ${shown})`);
  }
  step.click();
  assert.equal(step.disabled, true);
  assert.equal(document.activeElement, next.state(3), 'Next step on the last step should focus that state, not <body>');

  // A pointer click that did not focus the button (Safari) leaves focus where it was.
  const pointer = mountLab();
  document.activeElement = body;
  pointer.action('all').click();
  assert.equal(document.activeElement, body);
});

test('RNN lab: the sequence field keeps the full keyboard, so phones can type commas and minus signs', () => {
  const field = /<input id="rnn-\d+-inputs"[^>]*>/.exec(mountLab().root.innerHTML)[0];
  assert.match(field, /\btype="text"/);
  // inputmode="decimal" opens the iPhone decimal pad (digits and one separator) and "numeric" a digit pad.
  // Neither has the comma or minus key that a list such as "0.8, -1, 0.5" needs.
  const mode = /\binputmode="([^"]*)"/.exec(field)?.[1];
  assert.ok(mode === undefined || mode === 'text', `inputmode="${mode}" hides keys the sequence format needs`);
});
