// Entry point: loaded as the page's single <script type="module">.
// Importing every feature module here runs their top-level code once,
// which registers all the window.fn = fn hooks used by onclick="" in the HTML.
import './auth.js';
import './flashcard.js';
import './grammar.js';
import './minitest.js';
import './dictionary.js';
import './dashboard.js';
import './admin.js';
import './dictation.js';
import './vocabtest.js';

import { currentUser, loadLastSession } from './auth.js';
import {
  buildTopicChips, restart, history, correctCount, wrongCount,
  savedCorrect, savedWrong, bestComboSession, saveSession,
  checkAndAwardBadges, renderSummary, renderBadges, loadRanking,
  renderMyWords, markSessionSaved,
} from './flashcard.js';
import { initGrammarFilters, grammarDeck, buildGrammarDeck, renderGrammarCard } from './grammar.js';
import { initDictionary } from './dictionary.js';
import { initDictation } from './dictation.js';
import { loadDashboard } from './dashboard.js';
import { loadAdminUsers, loadOnlineUsers } from './admin.js';
import { showConfirm } from './utils.js';
import { initVocabTest, hasUnsavedVocabTest, clearVocabTest } from './vocabtest.js';

export const ALL_PANELS=['practice-panel','sum-panel','rank-panel','score-panel',
                  'grammar-panel','minitest-panel','dashboard-panel','admin-panel','dictionary-panel','mywords-panel',
                  'dictation-panel','vocabtest-panel'];
export let currentTop='flashcard';

export function switchTop(section, btn){
  // Chặn rời tab Kiểm tra từ vựng nếu đã ghi từ mà chưa bấm "Gửi bài" —
  // tránh học viên tra từ điển/dịch rồi quay lại ghi tiếp (gian lận).
  if(currentTop==='vocabtest' && section!=='vocabtest' && hasUnsavedVocabTest()){
    showConfirm(
      'Rời khỏi trang?',
      'Bạn chưa bấm "Gửi bài" — nếu rời khỏi trang này, TOÀN BỘ từ đã ghi sẽ bị XÓA. Bạn có chắc muốn rời đi không?',
      ()=>{ clearVocabTest(); doSwitchTop(section, btn); }
    );
    return;
  }
  doSwitchTop(section, btn);
}
window.switchTop=switchTop;

function doSwitchTop(section, btn){
  window.stopDictationAudio ? window.stopDictationAudio() : (window.speechSynthesis && window.speechSynthesis.cancel());
  currentTop=section;
  document.querySelectorAll('.top-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  ALL_PANELS.forEach(p=>{ const el=document.getElementById(p); if(el) el.style.display='none'; });
  const subNav=document.getElementById('flashcard-subnav');
  if(subNav) subNav.style.display=section==='flashcard'?'flex':'none';
  if(section==='flashcard'){
    const activeSubBtn=document.querySelector('#flashcard-subnav .tab-btn.active');
    const activeTab=activeSubBtn?.getAttribute('data-tab')||'practice';
    showFlashcardTab(activeTab);
  } else if(section==='grammar'){
    const gp=document.getElementById('grammar-panel');
    gp.style.display='block';gp.style.marginLeft='auto';gp.style.marginRight='auto';
    initGrammarFilters();
    if(!grammarDeck.length){buildGrammarDeck();renderGrammarCard();}
  } else if(section==='dictionary'){
    const dp2=document.getElementById('dictionary-panel');
    dp2.style.display='block';dp2.style.marginLeft='auto';dp2.style.marginRight='auto';
    initDictionary();
  } else if(section==='minitest'){
    const mp=document.getElementById('minitest-panel');
    mp.style.display='block';mp.style.marginLeft='auto';mp.style.marginRight='auto';
  } else if(section==='vocabtest'){
    const vp=document.getElementById('vocabtest-panel');
    vp.style.display='block';vp.style.marginLeft='auto';vp.style.marginRight='auto';
    initVocabTest();
  } else if(section==='dashboard'){
    const dp=document.getElementById('dashboard-panel');
    dp.style.display='block';dp.style.marginLeft='auto';dp.style.marginRight='auto';
    loadDashboard();
  } else if(section==='admin'){
    const ap=document.getElementById('admin-panel');
    ap.style.display='block';ap.style.marginLeft='auto';ap.style.marginRight='auto';
    loadAdminUsers();
    loadOnlineUsers();
    if(window.loadVocabTests) window.loadVocabTests();
  }
}

export function showFlashcardTab(tab){
  window.stopDictationAudio ? window.stopDictationAudio() : (window.speechSynthesis && window.speechSynthesis.cancel());
  document.getElementById('practice-panel').style.display=tab==='practice'?'':'none';
  if(tab!=='practice') document.getElementById('score-panel').style.display='none';
  // Show/hide mywords panel
  const mwEl=document.getElementById('mywords-panel');
  if(mwEl){
    mwEl.style.display=tab==='mywords'?'block':'none';
    mwEl.style.marginLeft='auto'; mwEl.style.marginRight='auto';
    if(tab==='mywords') renderMyWords();
  }
  const dictEl=document.getElementById('dictation-panel');
  if(dictEl){
    dictEl.style.display=tab==='dictation'?'block':'none';
    if(tab==='dictation'){ dictEl.style.marginLeft='auto'; dictEl.style.marginRight='auto'; initDictation(); }
  }
  const sumEl=document.getElementById('sum-panel');
  const rankEl=document.getElementById('rank-panel');
  sumEl.style.display=tab==='summary'?'block':'none';
  rankEl.style.display=tab==='ranking'?'block':'none';
  if(tab==='summary'||tab==='ranking'){
    // Force center alignment
    [sumEl,rankEl].forEach(el=>{
      el.style.marginLeft='auto';
      el.style.marginRight='auto';
    });
  }
  if(tab==='summary'){
    if(history.length===0){
      loadLastSession().then(()=>{ renderSummary(); renderBadges(); });
    } else {
      renderSummary(); renderBadges();
    }
  }
  if(tab==='ranking') loadRanking();
}

export function switchMainTab(tab, btn){
  document.querySelectorAll('#flashcard-subnav .tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  btn.setAttribute('data-tab', tab);
  const currentlyPractice=document.getElementById('practice-panel').style.display!=='none';
  if(currentlyPractice && tab!=='practice' && currentUser){
    const deltaC=correctCount-savedCorrect, deltaW=wrongCount-savedWrong;
    if(deltaC+deltaW>=5){
      const pct=(deltaC+deltaW)>0?Math.round(deltaC/(deltaC+deltaW)*100):0;
      saveSession(deltaC,deltaW,0,pct).then(()=>{
        markSessionSaved();
        checkAndAwardBadges({bestCombo:bestComboSession});
      }).catch(()=>{});
    }
  }
  showFlashcardTab(tab);
}
window.switchMainTab=switchMainTab;

// ── Flashcard logic ───────────────────────────────────────────────

export function setCurrentTop(v){ currentTop = v; }
