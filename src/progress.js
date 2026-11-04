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
