import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {FakeDocument, shownText} from './fake-dom.js';
import {quiz} from '../src/lessons.js';
import {CHAPTERS} from '../src/progress.js';

// The real page with site data blocked: reading window.localStorage throws, as it does in Chrome when the learner
// blocks site data. app.js keeps its state per page load, so this needs its own file (node --test runs each file in a
// separate process).
const document = new FakeDocument(await readFile(new URL('../index.html', import.meta.url), 'utf8'));
const window = {addEventListener() {}, removeEventListener() {}, get localStorage() { throw new Error("SecurityError: Failed to read the 'localStorage' property from 'Window'"); }};
Object.assign(globalThis, {document, window});
await import('../src/app.js');

const $ = selector => document.querySelector(selector);
const text = element => element.textContent.replace(/\s+/g, ' ').trim();

test('Blocked site data: from the first view the page says progress is not saved, and the labs and quiz still work', () => {
  const rail = $('.chapter-rail'), privacy = $('.privacy-details');
  assert.match(shownText(rail), /not saved/i, 'the progress rail says so');
  assert.equal(privacy.open, true, 'the privacy panel is open, so its status is shown and announced');
  assert.match(shownText($('#sources')), /Browser storage is unavailable or unreadable\. You can still use every lab and export progress for this session\./);
  assert.ok(rail.querySelectorAll('a').some(link => /not saved/i.test(shownText(link)) && link.getAttribute('href') === `#${privacy.id}`), 'the warning links to the panel that explains it');
  assert.ok(rail.querySelector('[role="alert"]')?.contains(rail.querySelector(`a[href="#${privacy.id}"]`)), 'the warning is an alert, so a screen reader announces it when it appears');
  // Under each chapter button and under the quiz the same words wait, with that link, until a change made there is not saved.
  const warnings = document.querySelectorAll('.storage-warning'), shown = () => warnings.filter(warning => shownText(warning) !== '').map(warning => warning.dataset.notSaved ?? 'rail');
  assert.equal(warnings.length, CHAPTERS.length + 2);
  for (const warning of warnings) {
    assert.equal(text(warning), 'Not saved on this browser');
    assert.equal(warning.querySelector('a').getAttribute('href'), `#${privacy.id}`);
  }
  assert.deepEqual(shown(), ['rail'], 'nothing has been changed yet');
  // The learner keeps working, and the warning stays.
  $('[data-complete="cnn"]').click();
  $('[data-complete="rnn"]').click();
  $(`#quiz [data-answer="${quiz[0].answer}"]`).click();
  assert.equal(text($('#progress-summary')), `2 of ${CHAPTERS.length} explored`);
  assert.equal(text($('#quiz .quiz-sidebar h3')), `1 / ${quiz.length} understood`);
  assert.match(shownText(rail), /not saved/i);
  assert.match(shownText($('#sources')), /Browser storage is unavailable or unreadable/);
  assert.deepEqual(shown(), ['rail', 'cnn', 'rnn', 'quiz'], 'a note under each control the learner has used');
});
