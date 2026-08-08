import { GRAMMAR_Q } from './data/grammar-questions.js';

export let mtDeck=[], mtIdx=0, mtScore=0, mtTimer=null, mtTimeLeft=1200;

export function startMiniTest(){
  // Pick 20 random grammar questions
  const shuffled=[...GRAMMAR_Q].sort(()=>Math.random()-.5);
  mtDeck=shuffled.slice(0,20);
  mtIdx=0; mtScore=0; mtTimeLeft=1200;
  document.getElementById('minitest-start').style.display='none';
  document.getElementById('minitest-result').style.display='none';
  document.getElementById('minitest-quiz').style.display='block';
  renderMTCard();
  startMTTimer();
}
window.startMiniTest=startMiniTest;

export function startMTTimer(){
  clearInterval(mtTimer);
  mtTimer=setInterval(()=>{
    mtTimeLeft--;
    const m=Math.floor(mtTimeLeft/60), s=mtTimeLeft%60;
    const el=document.getElementById('mt-timer');
    el.textContent=`${m}:${String(s).padStart(2,'0')}`;
    el.style.color=mtTimeLeft<=60?'var(--red)':mtTimeLeft<=180?'var(--yellow)':'var(--green)';
    if(mtTimeLeft<=0){clearInterval(mtTimer);showMTResult();}
  },1000);
}

export function renderMTCard(){
  if(mtIdx>=mtDeck.length){clearInterval(mtTimer);showMTResult();return;}
  const q=mtDeck[mtIdx];
  const pct=Math.round((mtIdx/mtDeck.length)*100);
  document.getElementById('mt-progress').textContent=`Câu ${mtIdx+1} / ${mtDeck.length}`;
  document.getElementById('mt-progress-bar').style.width=pct+'%';
  document.getElementById('mt-cat').textContent=q.cat.toUpperCase();
  document.getElementById('mt-sentence').textContent=q.s;
  document.getElementById('mt-explanation').style.display='none';
  document.getElementById('mt-next-wrap').style.display='none';
  document.getElementById('mt-card').style.borderColor='';
  const opts=document.getElementById('mt-options');
  opts.innerHTML=q.o.map((opt,i)=>`
    <button class="opt-btn" onclick="selectMTOpt(${i})">${opt}</button>
  `).join('');
}

export function selectMTOpt(i){
  const q=mtDeck[mtIdx];
  const btns=document.querySelectorAll('#mt-options .opt-btn');
  btns.forEach(b=>b.disabled=true);
  const correct=(i===q.a);
  btns[i].classList.add(correct?'selected-correct':'selected-wrong');
  if(!correct) btns[q.a].classList.add('show-correct');
  if(correct) mtScore++;
  // Show explanation
  const expEl=document.getElementById('mt-explanation');
  expEl.textContent='💡 '+q.e;
  expEl.style.display='block';
  // Update card border color
  document.getElementById('mt-card').style.borderColor=correct?'var(--green)':'var(--red)';
  // Show next button
  document.getElementById('mt-next-wrap').style.display='block';
}
export function mtNextCard(){
  document.getElementById('mt-next-wrap').style.display='none';
  document.getElementById('mt-card').style.borderColor='';
  mtIdx++;renderMTCard();
}
window.selectMTOpt=selectMTOpt;
window.mtNextCard=mtNextCard;

export function showMTResult(){
  clearInterval(mtTimer);
  document.getElementById('minitest-quiz').style.display='none';
  document.getElementById('minitest-result').style.display='block';
  const pct=Math.round((mtScore/20)*100);
  // Rough TOEIC Part 5 score estimate (out of ~100 pts for Part 5)
  const toeicEst=Math.round((mtScore/20)*100);
  document.getElementById('mt-score-big').textContent=`${mtScore}/20`;
  document.getElementById('mt-accuracy').textContent=`Độ chính xác: ${pct}%`;
  document.getElementById('mt-toeic-est').textContent=`Ước tính TOEIC Part 5: ~${toeicEst} điểm`;
  const emoji=pct>=90?'🏆':pct>=70?'🎉':pct>=50?'💪':'📚';
  document.getElementById('mt-result-emoji').textContent=emoji;
}

export function resetMiniTest(){
  clearInterval(mtTimer);
  document.getElementById('minitest-quiz').style.display='none';
  document.getElementById('minitest-result').style.display='none';
  document.getElementById('minitest-start').style.display='block';
}
window.resetMiniTest=resetMiniTest;

// ══════════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════════
