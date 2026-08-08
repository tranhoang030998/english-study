import { GRAMMAR_Q } from './data/grammar-questions.js';

export let grammarDeck=[], grammarIdx=0, grammarCorrect=0, grammarAnswered=false, grammarCat='all';

export const GRAMMAR_CATS=[...new Set(GRAMMAR_Q.map(q=>q.cat))];

export function initGrammarFilters(){
  const wrap=document.getElementById('grammar-filter');
  if(!wrap||wrap.children.length>1) return;
  GRAMMAR_CATS.forEach(cat=>{
    const b=document.createElement('button');
    b.className='topic-chip';b.textContent=cat;
    b.onclick=()=>setGrammarCat(cat,b);
    wrap.appendChild(b);
  });
}

export function setGrammarCat(cat,btn){
  grammarCat=cat;
  document.querySelectorAll('#grammar-filter .topic-chip').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  buildGrammarDeck();renderGrammarCard();
}
window.setGrammarCat=setGrammarCat;

export function buildGrammarDeck(){
  let pool = grammarCat==='all' ? [...GRAMMAR_Q] : GRAMMAR_Q.filter(q=>q.cat===grammarCat);
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
  grammarDeck=pool; grammarIdx=0; grammarCorrect=0;
}

export function renderGrammarCard(){
  if(grammarIdx>=grammarDeck.length){
    // cycle back
    buildGrammarDeck(); return;
  }
  const q=grammarDeck[grammarIdx]; grammarAnswered=false;
  document.getElementById('grammar-next-btn').textContent='Bỏ qua →';
  document.getElementById('grammar-cat-badge').textContent=q.cat.toUpperCase();
  document.getElementById('grammar-sentence').textContent=q.s;
  document.getElementById('grammar-explanation').style.display='none';
  document.getElementById('grammar-card').style.borderColor='';

  const opts=document.getElementById('grammar-options');
  opts.innerHTML=q.o.map((opt,i)=>`
    <button class="opt-btn" onclick="selectGrammarOpt(${i})">${opt}</button>
  `).join('');

  const pct=grammarDeck.length?Math.round((grammarIdx/grammarDeck.length)*100):0;
  document.getElementById('grammar-progress').style.width=pct+'%';
  document.getElementById('grammar-prog-text').textContent=`Câu ${grammarIdx+1} / ${grammarDeck.length}`;
  document.getElementById('grammar-score-display').textContent=grammarCorrect+' đúng';
}

export function selectGrammarOpt(i){
  if(grammarAnswered) return;
  grammarAnswered=true;
  const q=grammarDeck[grammarIdx];
  const btns=document.querySelectorAll('#grammar-options .opt-btn');
  btns.forEach(b=>b.disabled=true);
  const correct=(i===q.a);
  btns[i].classList.add(correct?'selected-correct':'selected-wrong');
  if(!correct) btns[q.a].classList.add('show-correct');
  document.getElementById('grammar-card').style.borderColor=correct?'var(--green)':'var(--red)';
  const expEl=document.getElementById('grammar-explanation');
  expEl.textContent='💡 '+q.e;
  expEl.style.display='block';
  if(correct){grammarCorrect++;document.getElementById('grammar-score-display').textContent=grammarCorrect+' đúng';}
  document.getElementById('grammar-next-btn').textContent='Tiếp tục →';
}
window.selectGrammarOpt=selectGrammarOpt;

export function grammarNext(){
  grammarIdx++;renderGrammarCard();
}
export function grammarPrev(){
  if(grammarIdx>0){grammarIdx--;renderGrammarCard();}
}
window.grammarNext=grammarNext;
window.grammarPrev=grammarPrev;

// ══════════════════════════════════════════════════════
//  MINI TEST
// ══════════════════════════════════════════════════════
