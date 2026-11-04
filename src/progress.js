export const STORAGE_KEY = 'attention-atlas-progress-v1';
export const CHAPTERS = ['foundations','cnn','rnn','attention','transformer','practice'];
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
