import {mountComplexity,mountNormalization,mountScaling} from './advanced-labs.js';
import {mountLearningTools} from './learning-tools.js';
import {lessons,quiz,sources} from './lessons.js';
import {mountCNN,mountAttention,mountTransformer} from './visual-labs.js';
import {mountRNN,mountPosition} from './sequence-labs.js';
import {loadProgress,saveProgress,normalizeProgress,parseProgressImport,mergeProgress,CHAPTERS} from './progress.js';
const $=s=>document.querySelector(s);
let storage;try{storage=window.localStorage;}catch{storage=null;}
let {data:progress,available}=loadProgress(storage,quiz);
let questionIndex=0;
for(const lesson of lessons){const holder=document.querySelector(`[data-lesson="${lesson.id}"]`);holder.innerHTML=`<details><summary>The maths, explained · ${lesson.title}</summary><div class="lesson-body">${lesson.body}</div></details>`;}
mountLearningTools($('#learning-tools'));mountScaling($('#scaling-lab'));mountNormalization($('#normalization-lab'));mountComplexity($('#complexity-lab'));mountCNN($('#cnn-lab'));mountRNN($('#rnn-lab'));mountAttention($('#attention-lab'));mountTransformer($('#transformer-map'));mountPosition($('#position-lab'));
for(const [id,title] of [['rnn-lab','EXPERIMENT 02 / TRACE THE MEMORY'],['position-lab','EXPERIMENT 05 / A POSITION SIGNATURE']]){const lab=document.getElementById(id),body=document.createElement('div');body.className='lab-body';body.append(...lab.childNodes);lab.append(body);const bar=document.createElement('div');bar.className='lab-topbar';bar.innerHTML=`<span class="eyebrow">${title}</span><span class="pill">Change a parameter</span>`;document.getElementById(id).prepend(bar);}
function storageStatus(){ $('#storage-status').textContent=available?'Progress is saved on this browser only.': 'Browser storage is unavailable or unreadable. You can still use every lab and export progress for this session.'; }
function disarmReset(){resetArmed=false;$('#reset-progress').textContent='Reset local progress';}
function persist(){disarmReset();available=saveProgress(storage,progress);storageStatus();}
function renderProgress(){
  $('#progress-summary').textContent=`${progress.completed.length} of ${CHAPTERS.length} explored`;
  $('#progress-dots').innerHTML=CHAPTERS.map(id=>`<a href="#${id}" class="${progress.completed.includes(id)?'done':''}" aria-label="${id}: ${progress.completed.includes(id)?'explored':'not marked explored'}"></a>`).join('');
  document.querySelectorAll('[data-complete]').forEach(b=>{const complete=progress.completed.includes(b.dataset.complete);b.setAttribute('aria-pressed',String(complete));b.textContent=complete?'✓ Chapter explored · undo':'Mark this chapter explored';});
}
document.querySelectorAll('[data-complete]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.complete;progress.completed=progress.completed.includes(id)?progress.completed.filter(x=>x!==id):[...progress.completed,id];persist();renderProgress();}));
function renderQuiz(focusQuestion=false){
 const q=quiz[questionIndex],selected=progress.answers[q.id],answered=selected!==undefined,correct=selected===q.answer;
 const solved=quiz.filter(x=>progress.answers[x.id]===x.answer).length;
 $('#quiz').innerHTML=`<aside class="quiz-sidebar"><span class="eyebrow">KNOWLEDGE CHECK</span><h3>${solved} / ${quiz.length} understood</h3><p>Reason it through. You can retry every question.</p><nav class="quiz-numbers" aria-label="Choose a practice question">${quiz.map((x,i)=>`<button class="quiz-number ${progress.answers[x.id]===x.answer?'solved':''}" data-question="${i}" aria-label="Question ${i+1}${progress.answers[x.id]===x.answer?', correct':''}" aria-current="${i===questionIndex}">${String(i+1).padStart(2,'0')}</button>`).join('')}</nav></aside><div class="quiz-main"><div class="eyebrow">${q.topic} / QUESTION ${String(questionIndex+1).padStart(2,'0')}</div><h3 id="quiz-question" tabindex="-1">${q.question}</h3><div role="group" aria-labelledby="quiz-question">${q.choices.map((c,i)=>`<button class="quiz-choice ${answered&&i===q.answer?'correct':answered&&i===selected?'incorrect':''}" data-answer="${i}" ${answered?'disabled':''}><span class="letter">${String.fromCharCode(65+i)}</span><span>${c}</span></button>`).join('')}</div>${answered?`<div class="quiz-feedback" role="status"><strong>${correct?'That’s right.':'A useful mistake to learn from.'}</strong><p>${q.explanation}</p></div>`:''}<div class="quiz-navigation"><button class="btn secondary" id="quiz-prev" ${questionIndex===0?'disabled':''}>← Previous</button>${answered?'<button class="btn secondary" id="quiz-retry">Try again</button>':`<span class="quiz-count">${questionIndex+1} / ${quiz.length}</span>`}<button class="btn primary" id="quiz-next">${questionIndex===quiz.length-1?'Back to first ↻':'Next →'}</button></div></div>`;
 if(focusQuestion)$('#quiz-question').focus({preventScroll:true});
}
$('#quiz').addEventListener('click',e=>{const answer=e.target.closest('[data-answer]'),number=e.target.closest('[data-question]'),target=e.target.closest('button');if(!target)return;
 if(answer){const q=quiz[questionIndex];if(progress.answers[q.id]!==undefined)return;progress.answers[q.id]=Number(answer.dataset.answer);persist();renderQuiz();$('#quiz-retry').focus({preventScroll:true});}
 else if(number){questionIndex=Number(number.dataset.question);renderQuiz(true);}
 else if(target.id==='quiz-prev'){questionIndex=Math.max(0,questionIndex-1);renderQuiz(true);}
 else if(target.id==='quiz-next'){questionIndex=(questionIndex+1)%quiz.length;renderQuiz(true);}
 else if(target.id==='quiz-retry'){delete progress.answers[quiz[questionIndex].id];persist();renderQuiz(true);}
});
$('#source-list').innerHTML=sources.map((s,i)=>`<a class="source" href="${s.url}" target="_blank" rel="noopener noreferrer"><span class="source-title"><span>${String(i+1).padStart(2,'0')} &nbsp; ${s.title}</span><span aria-hidden="true">↗</span></span><p>${s.note}</p></a>`).join('');
$('#export-progress').addEventListener('click',()=>{const payload={app:'Attention Atlas',version:1,exportedAt:new Date().toISOString(),...progress};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='attention-atlas-progress.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);$('#storage-status').textContent='Progress export prepared. Keep the JSON file as your personal learning record.';});
let resetArmed=false;
$('#reset-progress').addEventListener('click',()=>{if(!resetArmed){resetArmed=true;$('#reset-progress').textContent='Confirm reset — erase progress';$('#storage-status').textContent='This removes chapter marks and quiz answers on this browser. Click Confirm reset to continue.';return;}progress=normalizeProgress(null);persist();renderProgress();questionIndex=0;renderQuiz();resetArmed=false;$('#reset-progress').textContent='Reset local progress';$('#storage-status').textContent=available?'Local progress has been reset.':'Session progress has been reset; browser storage is unavailable.';});
renderProgress();renderQuiz();storageStatus();

$('#import-progress').addEventListener('change',async e=>{const input=e.currentTarget,file=input.files?.[0];if(!file)return;try{if(file.size>65536)throw new Error('Choose a progress export smaller than 64 KB.');const imported=parseProgressImport(await file.text(),quiz);progress=mergeProgress(progress,imported,quiz);persist();renderProgress();renderQuiz();$('#storage-status').textContent=available?'Progress imported and merged with this browser’s progress.':'Progress imported for this session; browser storage is unavailable.';}catch(error){$('#storage-status').textContent=error.message;}finally{input.value='';}});

$('.privacy-details').addEventListener('toggle',e=>{if(!e.currentTarget.open)disarmReset();});
