export const STORAGE_KEY = 'attention-atlas-progress-v1';
export const CHAPTERS = ['foundations','cnn','rnn','attention','transformer','practice'];

/** A revision queue based on current answers, not an estimate of mastery.
 * Incorrect answers come first, then unseen questions; source order breaks ties. */
export function revisionPlan(value, quiz = []) {
  const progress = normalizeProgress(value, quiz);
  const pending = quiz.map((question, index) => ({ id: question.id, index,
    topic: question.topic, status: progress.answers[question.id] === undefined
      ? 'unanswered' : progress.answers[question.id] === question.answer ? 'correct' : 'incorrect' }));
  return [...pending.filter(item => item.status === 'incorrect'),
    ...pending.filter(item => item.status === 'unanswered')];
}
export function normalizeProgress(value, quiz = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {completed:[], answers:{}};
  const completed = [...new Set(Array.isArray(value.completed) ? value.completed.filter(x=>CHAPTERS.includes(x)) : [])];
  const answers = {};
  for (const q of quiz) {
    const choice = value.answers?.[q.id];
    if (Number.isInteger(choice) && choice >= 0 && choice < q.choices.length) answers[q.id] = choice;
  }
  return {completed, answers};
}
export function loadProgress(storage, quiz) {
  try { return {data:normalizeProgress(JSON.parse(storage.getItem(STORAGE_KEY)), quiz), available:true}; }
  catch { return {data:normalizeProgress(null), available:false}; }
}
export function saveProgress(storage, progress) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(progress)); return true; } catch { return false; }
}

export function parseProgressImport(text,quiz=[]) {
  if(typeof text!=='string'||new TextEncoder().encode(text).length>65536)throw new Error('Choose a progress export smaller than 64 KB.');
  let value;try{value=JSON.parse(text);}catch{throw new Error('This file is not valid JSON. Choose an Attention Atlas progress export.');}
  if(!value||value.app!=='Attention Atlas'||value.version!==1||!Array.isArray(value.completed)||!value.answers||typeof value.answers!=='object'||Array.isArray(value.answers))throw new Error('This is not a supported Attention Atlas progress export (version 1).');
  return normalizeProgress(value,quiz);
}

export function mergeProgress(current,incoming,quiz=[]) {
  const local=normalizeProgress(current,quiz), imported=normalizeProgress(incoming,quiz);
  const answers={...local.answers,...imported.answers};
  for(const q of quiz)if(local.answers[q.id]===q.answer)answers[q.id]=q.answer;
  return {completed:[...new Set([...local.completed,...imported.completed])],answers};
}

/** Apply only this tab's changes to the latest stored snapshot. A stale tab must
 * not restore chapter marks or answers that another tab deliberately removed. */
export function commitProgress(storage, previous, next, quiz = [], { reset = false, preserveCorrect = false, imported } = {}) {
  const before = normalizeProgress(previous, quiz), desired = normalizeProgress(next, quiz);
  try {
    const loaded = loadProgress(storage, quiz);
    if (!reset && !loaded.available) return { data: desired, available: false };
    const data = reset ? desired : normalizeProgress(loaded.data, quiz);
    if (!reset) {
      for (const chapter of CHAPTERS) {
        if (before.completed.includes(chapter) === desired.completed.includes(chapter)) continue;
        data.completed = desired.completed.includes(chapter)
          ? [...new Set([...data.completed, chapter])]
          : data.completed.filter(id => id !== chapter);
      }
      for (const q of quiz) {
        if (before.answers[q.id] === desired.answers[q.id]) continue;
        if (preserveCorrect && data.answers[q.id] === q.answer) continue;
        if (desired.answers[q.id] === undefined) delete data.answers[q.id];
        else data.answers[q.id] = desired.answers[q.id];
      }
    }
    if (imported) {
      // Import is an explicit request, even if the stale tab already displayed
      // the same mark. Apply only the backup's fields, not all stale local data.
      const incoming = normalizeProgress(imported, quiz);
      data.completed = [...new Set([...data.completed, ...incoming.completed])];
      for (const q of quiz) {
        if (incoming.answers[q.id] !== undefined && data.answers[q.id] !== q.answer)
          data.answers[q.id] = incoming.answers[q.id];
      }
    }
    if (!saveProgress(storage, data)) return { data: desired, available: false };
    return { data, available: true };
  } catch { return { data: desired, available: false }; }
}

/** Events are queued snapshots. Read storage again so an old event cannot
 * resurrect progress after a later reset; clear() sends a null key. */
export function subscribeProgressChanges(target, storage, quiz, onChange, onError) {
  const listener = event => {
    if ((event.key !== STORAGE_KEY && event.key !== null) || event.storageArea !== storage) return;
    const result = loadProgress(storage, quiz);
    if (result.available) onChange(result.data);
    else onError();
  };
  target.addEventListener('storage', listener);
  return () => target.removeEventListener('storage', listener);
}
