import {mountComplexity,mountNormalization,mountScaling} from './advanced-labs.js';
import {mountLearningTools} from './learning-tools.js';
import {lessons,quiz,sources} from './lessons.js';
import {mountCNN,mountAttention,mountTransformer} from './visual-labs.js';
import {mountRNN,mountPosition} from './sequence-labs.js';
import {mountScene3D} from './scene3d.js';
import {loadProgress,commitProgress,subscribeProgressChanges,normalizeProgress,parseProgressImport,mergeProgress,revisionPlan,CHAPTERS} from './progress.js';
const $=s=>document.querySelector(s);
let storage;try{storage=window.localStorage;}catch{storage=null;}
let {data:progress,available}=loadProgress(storage,quiz);
let storedProgress=normalizeProgress(progress,quiz);
let unsaved=false;
let transientLearningState=false;
window.appUpdateCanReload=()=>available&&!unsaved&&!transientLearningState&&!resetArmed;
for(const type of ['pointerdown','keydown'])document.addEventListener(type,event=>{if(event.target.closest?.('#quiz,[id$="-lab"],#transformer-map,#learning-tools'))transientLearningState=true;},true);
// Chapters and questions set here since the last successful save. A failed save leaves storedProgress stale, so
// commitProgress is told about them: a learner may set again what another tab undid meanwhile. What another tab
// changes after that is the newer change, so it leaves the list when it arrives; seenProgress, the saved progress
// this tab last read, tells which chapters and answers those are.
let changed={completed:new Set(),answers:new Set()},seenProgress=storedProgress;
let questionIndex=0;
for(const lesson of lessons){const holder=document.querySelector(`[data-lesson="${lesson.id}"]`);holder.innerHTML=`<details><summary>The maths, explained · ${lesson.title}</summary><div class="lesson-body">${lesson.body}</div></details>`;}
mountLearningTools($('#learning-tools'));mountScaling($('#scaling-lab'));mountNormalization($('#normalization-lab'));mountComplexity($('#complexity-lab'));mountCNN($('#cnn-lab'));mountRNN($('#rnn-lab'));mountAttention($('#attention-lab'));mountTransformer($('#transformer-map'));mountPosition($('#position-lab'));
for(const [id,title] of [['rnn-lab','EXPERIMENT 02 / TRACE THE MEMORY'],['position-lab','EXPERIMENT 05 / A POSITION SIGNATURE']]){const lab=document.getElementById(id),body=document.createElement('div');body.className='lab-body';body.append(...lab.childNodes);lab.append(body);const bar=document.createElement('div');bar.className='lab-topbar';bar.innerHTML=`<span class="eyebrow">${title}</span><span class="pill">Change a parameter</span>`;document.getElementById(id).prepend(bar);}
mountScene3D({documentRef:document,windowRef:window});
// Every progress message goes through here. The status line sits in the collapsed privacy panel, so while progress is
// not being saved each new message opens the panel (it is then shown and announced, beside Export), and the progress
// rail says so too. Both are far from a learner marking a chapter or answering a question, so persist() also shows a
// note under that button or under the quiz: below what was just used, where it pushes nothing the learner is looking
// at further down. The notes go when a save works.
function storageStatus(message=available?'Progress is saved on this browser only.':'Browser storage is unavailable or unreadable. You can still use every lab and export progress for this session.'){const status=$('#storage-status');if(!available&&status.textContent!==message)$('.privacy-details').open=true;status.textContent=message;$('#storage-warning').hidden=available;if(available)document.querySelectorAll('[data-not-saved]').forEach(note=>{note.hidden=true;});}
function disarmReset(){resetArmed=false;$('#reset-progress').textContent='Reset local progress';}
function persist({near,...options}={}){disarmReset();const result=commitProgress(storage,storedProgress,progress,quiz,{...options,changed});progress=result.data;available=result.available;unsaved=!available;if(available){storedProgress=seenProgress=normalizeProgress(progress,quiz);changed={completed:new Set(),answers:new Set()};}storageStatus();if(!available&&near)$(`[data-not-saved="${near}"]`).hidden=false;}
function renderProgress(){
  $('#progress-summary').textContent=`${progress.completed.length} of ${CHAPTERS.length} explored`;
  $('#progress-dots').innerHTML=CHAPTERS.map(id=>`<a href="#${id}" class="${progress.completed.includes(id)?'done':''}" aria-label="${id}: ${progress.completed.includes(id)?'explored':'not marked explored'}"></a>`).join('');
  document.querySelectorAll('[data-complete]').forEach(b=>{const complete=progress.completed.includes(b.dataset.complete);b.setAttribute('aria-pressed',String(complete));b.textContent=complete?'✓ Chapter explored · undo':'Mark this chapter explored';});
}
document.querySelectorAll('[data-complete]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.complete;changed.completed.add(id);progress.completed=progress.completed.includes(id)?progress.completed.filter(x=>x!==id):[...progress.completed,id];persist({near:id});renderProgress();}));
function renderQuiz(focusQuestion=false){
 const q=quiz[questionIndex],selected=progress.answers[q.id],answered=selected!==undefined,correct=selected===q.answer;
 const solved=quiz.filter(x=>progress.answers[x.id]===x.answer).length;
 const plan=revisionPlan(progress,quiz), mistakes=plan.filter(item=>item.status==='incorrect').length;
 const recommendation=plan.length?`<p class="revision-summary">${mistakes} to revisit · ${plan.length-mistakes} unanswered</p><button class="btn secondary" id="quiz-recommended">${mistakes?'Revisit a mistake':'Continue unanswered'} →</button>`:'<p class="revision-summary">Every current answer is correct. Revisit any question to keep practising.</p>';
 $('#quiz').innerHTML=`<aside class="quiz-sidebar"><span class="eyebrow">KNOWLEDGE CHECK</span><h3>${solved} / ${quiz.length} understood</h3><p>Reason it through. You can retry every question.</p>${recommendation}<nav class="quiz-numbers" aria-label="Choose a practice question">${quiz.map((x,i)=>`<button class="quiz-number ${progress.answers[x.id]===x.answer?'solved':''}" data-question="${i}" aria-label="Question ${i+1}${progress.answers[x.id]===x.answer?', correct':''}" aria-current="${i===questionIndex}">${String(i+1).padStart(2,'0')}</button>`).join('')}</nav></aside><div class="quiz-main"><div class="eyebrow">${q.topic} / QUESTION ${String(questionIndex+1).padStart(2,'0')}</div><h3 id="quiz-question" tabindex="-1">${q.question}</h3><div role="group" aria-labelledby="quiz-question">${q.choices.map((c,i)=>`<button class="quiz-choice ${answered&&i===q.answer?'correct':answered&&i===selected?'incorrect':''}" data-answer="${i}" ${answered?'disabled':''}><span class="letter">${String.fromCharCode(65+i)}</span><span>${c}</span></button>`).join('')}</div>${answered?`<div class="quiz-feedback" role="status"><strong>${correct?'That’s right.':'A useful mistake to learn from.'}</strong><p>${q.explanation}</p></div>`:''}<div class="quiz-navigation"><button class="btn secondary" id="quiz-prev" ${questionIndex===0?'disabled':''}>← Previous</button>${answered?'<button class="btn secondary" id="quiz-retry">Try again</button>':`<span class="quiz-count">${questionIndex+1} / ${quiz.length}</span>`}<button class="btn primary" id="quiz-next">${questionIndex===quiz.length-1?'Back to first ↻':'Next →'}</button></div></div>`;
 if(focusQuestion)$('#quiz-question').focus({preventScroll:true});
}
$('#quiz').addEventListener('click',e=>{const answer=e.target.closest('[data-answer]'),number=e.target.closest('[data-question]'),target=e.target.closest('button');if(!target)return;
 if(answer){const q=quiz[questionIndex];if(progress.answers[q.id]!==undefined)return;progress.answers[q.id]=Number(answer.dataset.answer);changed.answers.add(q.id);persist({near:'quiz'});renderQuiz();($('#quiz-retry')??$('#quiz-question')).focus({preventScroll:true});}
 else if(number){questionIndex=Number(number.dataset.question);renderQuiz(true);}
 else if(target.id==='quiz-recommended'){const next=revisionPlan(progress,quiz)[0];if(next){questionIndex=next.index;renderQuiz(true);}}
 else if(target.id==='quiz-prev'){questionIndex=Math.max(0,questionIndex-1);renderQuiz(true);}
 else if(target.id==='quiz-next'){questionIndex=(questionIndex+1)%quiz.length;renderQuiz(true);}
 else if(target.id==='quiz-retry'){const id=quiz[questionIndex].id;delete progress.answers[id];changed.answers.add(id);persist({near:'quiz'});renderQuiz(true);}
});
$('#source-list').innerHTML=sources.map((s,i)=>`<a class="source" href="${s.url}" target="_blank" rel="noopener noreferrer"><span class="source-title"><span>${String(i+1).padStart(2,'0')} &nbsp; ${s.title}</span><span aria-hidden="true">↗</span></span><p>${s.note}</p></a>`).join('');
$('#export-progress').addEventListener('click',()=>{const payload={app:'Attention Atlas',version:1,exportedAt:new Date().toISOString(),...progress};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='attention-atlas-progress.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);storageStatus('Progress export prepared. Keep the JSON file as your personal learning record.');});
let resetArmed=false;
$('#reset-progress').addEventListener('click',()=>{if(!resetArmed){resetArmed=true;$('#reset-progress').textContent='Confirm reset — erase progress';storageStatus('This removes chapter marks and quiz answers on this browser. Click Confirm reset to continue.');return;}progress=normalizeProgress(null);persist({reset:true});renderProgress();questionIndex=0;renderQuiz();resetArmed=false;$('#reset-progress').textContent='Reset local progress';storageStatus(available?'Local progress has been reset.':'Session progress has been reset; browser storage is unavailable.');});
renderProgress();renderQuiz();storageStatus();

$('#import-progress').addEventListener('change',async e=>{const input=e.currentTarget,file=input.files?.[0];if(!file)return;try{if(file.size>65536)throw new Error('Choose a progress export smaller than 64 KB.');const imported=parseProgressImport(await file.text(),quiz);progress=mergeProgress(progress,imported,quiz);persist({preserveCorrect:true,imported});renderProgress();renderQuiz();storageStatus(available?'Progress imported and merged with this browser’s progress.':'Progress imported for this session; browser storage is unavailable.');}catch(error){storageStatus(error.message);}finally{input.value='';}});

$('.privacy-details').addEventListener('toggle',e=>{if(!e.currentTarget.open)disarmReset();});

subscribeProgressChanges(window,storage,quiz,next=>{
 // Keep an unsaved session after quota/permission errors. Its next successful
 // action is rebased against current storage instead of erasing either copy.
 if(unsaved){
  // What the other tab has just changed is newer than anything set here before it: it is no longer forced over it.
  for(const id of CHAPTERS)if(seenProgress.completed.includes(id)!==next.completed.includes(id))changed.completed.delete(id);
  for(const q of quiz)if(seenProgress.answers[q.id]!==next.answers[q.id])changed.answers.delete(q.id);
  seenProgress=next;storageStatus('Another tab updated saved progress. Your unsaved work remains here; export it before leaving.');return;}
 const focusQuestion=$('#quiz').contains(document.activeElement);
 progress=next;storedProgress=seenProgress=normalizeProgress(next,quiz);available=true;disarmReset();
 renderProgress();renderQuiz(focusQuestion);storageStatus();
},()=>{available=false;storageStatus();});
