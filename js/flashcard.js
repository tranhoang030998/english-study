import { db } from './firebase-config.js';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where, increment, serverTimestamp, arrayUnion } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { acceptableMatch, getVNDate, getWeekKey, getVNMonth, showConfirm, levenshtein } from './utils.js';
import { currentUser, loadUserStreak, saveLastSessionLocal, saveLastSession } from './auth.js';
import { ALL_WORDS } from './data/words.js';
import { STOP_WORDS, EXTRA_DICT, COMMON_WORDS, DICT_API } from './data/dictionary-data.js';
import { KNOWN_PHRASES } from './data/phrases.js';
import { dictSpeak } from './dictionary.js';
import { deleteUserRanking } from './admin.js';

export let mode='en-vn', activeTopic='all', deck=[], idx=0, answered=false;
export let correctCount=0, wrongCount=0, skipCount=0, history=[], sumFilter='all';
export let savedCorrect=0, savedWrong=0; // track what's already been saved to avoid double-counting
export let wrongStreak=0; // consecutive wrong answers

export const topics=[...new Set(ALL_WORDS.map(w=>w.topic))].sort();

export function buildTopicChips(){
  const wrap=document.getElementById('topic-chips');
  wrap.innerHTML='';
  const a=document.createElement('button');
  a.className='topic-chip active';a.textContent='Tất cả';
  a.onclick=()=>setTopic('all',a);wrap.appendChild(a);
  // Bookmark chip
  const bk=document.createElement('button');
  bk.className='topic-chip';bk.id='bookmark-chip';
  bk.innerHTML='⭐ Đã đánh dấu';
  bk.onclick=()=>setTopic('bookmarks',bk);wrap.appendChild(bk);
  // My words chip
  const mwc=document.createElement('button');
  mwc.className='topic-chip';mwc.id='myword-chip';
  mwc.innerHTML='📝 Từ riêng';
  mwc.onclick=()=>setTopic('mywords',mwc);wrap.appendChild(mwc);
  topics.forEach(t=>{
    const b=document.createElement('button');
    b.className='topic-chip';b.textContent=t;
    b.onclick=()=>setTopic(t,b);wrap.appendChild(b);
  });
}


// Custom confirm modal (replaces native confirm() which is blocked on iOS)
export function setTopic(t,btn){
  if(t===activeTopic) return;
  const answered = correctCount + wrongCount + skipCount;
  if(answered > 0){
    showConfirm('Đổi chủ đề', 'Tiến độ hiện tại sẽ bị reset. Bạn muốn tiếp tục?', ()=>{
      activeTopic=t;
      document.querySelectorAll('.topic-chip').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');restart();
    });
  } else {
    activeTopic=t;
    document.querySelectorAll('.topic-chip').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');restart();
  }
}
window.setTopic=setTopic;

export function setMode(m){
  if(m===mode) return;
  const answered = correctCount + wrongCount + skipCount;
  if(answered > 0){
    showConfirm('Đổi chế độ', 'Tiến độ hiện tại sẽ bị reset. Bạn muốn tiếp tục?', ()=>{
      mode=m;
      document.querySelectorAll('.mode-btn').forEach((b,i)=>{
        b.classList.toggle('active',['en-vn','vn-en','random'][i]===m);
      });restart();
    });
  } else {
    mode=m;
    document.querySelectorAll('.mode-btn').forEach((b,i)=>{
      b.classList.toggle('active',['en-vn','vn-en','random'][i]===m);
    });restart();
  }
}
window.setMode=setMode;

export function buildDeck(){
  let pool;
  if(activeTopic==='mywords'){
    const seen2=new Set();
    pool=myWords.map(w=>({topic:'Từ riêng',en:w.en,pos:'',en_alt:[],vn:w.vn,vn_alt:[],ex:w.ex||''}))
      .filter(w=>{ if(!seen2.has(w.en)){seen2.add(w.en);return true;}return false; });
  } else if(activeTopic==='bookmarks'){
    const seen = new Set();
    pool = ALL_WORDS.filter(w=>{ if(bookmarks.has(w.en) && !seen.has(w.en)){ seen.add(w.en); return true; } return false; });
    // Also include bookmarked custom words (Từ riêng)
    const bmCustom = myWords.filter(w=>bookmarks.has(w.en) && !seen.has(w.en)).map(w=>{
      seen.add(w.en);
      return {topic:'Từ riêng',en:w.en,pos:'',en_alt:[],vn:w.vn,vn_alt:[],ex:w.ex||''};
    });
    pool = [...pool, ...bmCustom];
    // Cleanup orphaned bookmarks (words in bookmarks that no longer exist)
    if(pool.length < bookmarks.size){
      const validEns = new Set(pool.map(w=>w.en));
      const orphaned = [...bookmarks].filter(en=>!validEns.has(en));
      if(orphaned.length>0){
        orphaned.forEach(en=>bookmarks.delete(en));
        const lsKeyBm2='toeic_bm_'+currentUser.username;
        localStorage.setItem(lsKeyBm2,JSON.stringify([...bookmarks]));
        updateDoc(doc(db,'users',currentUser.username),{bookmarks:[...bookmarks]}).catch(()=>{});
        updateBookmarkChip();
      }
    }
    // If empty, deck=[] will be handled by renderCard()
  } else if(activeTopic==='all'){
    pool=[...ALL_WORDS];
  } else {
    pool=ALL_WORDS.filter(w=>w.topic===activeTopic);
  }
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
  deck=pool.map(w=>{let m=mode;if(m==='random')m=Math.random()<.5?'en-vn':'vn-en';return{...w,cardMode:m};});
  idx=0;correctCount=0;wrongCount=0;skipCount=0;history=[];savedCorrect=0;savedWrong=0;bestComboSession=0;resetCombo();wrongStreak=0;
}

export function renderCard(){
  // Show/hide bookmark empty state
  const bmEmpty = document.getElementById('bookmark-empty');
  const flashcard = document.getElementById('flashcard');
  if(deck.length===0 && (activeTopic==='bookmarks'||activeTopic==='mywords')){
    if(bmEmpty){
      bmEmpty.style.display='flex';
      bmEmpty.querySelector('div:nth-child(2)').textContent=
        activeTopic==='mywords'?'Chưa có từ riêng nào':'Chưa có từ nào được đánh dấu';
      bmEmpty.querySelector('div:nth-child(3)').textContent=
        activeTopic==='mywords'?'Vào tab "📝 Từ riêng" để thêm từ mới':'Bấm ☆ trên thẻ từ để đánh dấu từ khó';
    }
    if(flashcard){ flashcard.style.display='none'; }
    document.getElementById('progress-fill').style.width='0%';
    document.getElementById('prog-text').textContent='0 từ đã đánh dấu';
    document.getElementById('prog-pct').textContent='';
    document.getElementById('feedback').textContent='';
    document.getElementById('answer-input').value='';
    document.getElementById('btn-skip').textContent='Bỏ qua →';
    return;
  } else {
    if(bmEmpty) bmEmpty.style.display='none';
    if(flashcard) flashcard.style.display='';
  }
  if(idx>=deck.length){showScore();return;}
  const card=deck[idx];answered=false;
  document.getElementById('btn-skip').textContent='Bỏ qua →';
  document.getElementById('flashcard').className='flashcard';
  document.getElementById('card-topic').textContent=card.topic;
  document.getElementById('card-counter').textContent=`${idx+1} / ${deck.length}`;
  const wordEl=document.getElementById('card-word');
  const inp=document.getElementById('answer-input');
  const posEl    = document.getElementById('card-pos');
  const speakBtn = document.getElementById('btn-speak');
  if(card.cardMode==='en-vn'){
    wordEl.textContent=card.en;wordEl.className='card-word';
    inp.placeholder='Nhập nghĩa tiếng Việt...';
    posEl.textContent=card.pos||'';posEl.style.display=card.pos?'inline-block':'none';
    speakBtn.style.display='inline-flex';
  }else{
    wordEl.textContent=card.vn;wordEl.className='card-word vn';
    inp.placeholder='Nhập từ tiếng Anh...';
    posEl.style.display='none';
    speakBtn.style.display='none';
  }
  // Stop any ongoing speech when new card loads
  window.speechSynthesis && window.speechSynthesis.cancel();
  speakBtn.classList.remove('speaking');
  const exEl=document.getElementById('card-example');
  if(card.ex && card.cardMode==='en-vn'){
    // Make each word clickable
    const words = card.ex.split(/(\s+|[.,!?;:])/);
    exEl.innerHTML = words.map(w => {
      const clean = w.trim().replace(/[^a-zA-Z'-]/g,'');
      if(clean.length > 1){
        return '<span class="clickable-word" data-word="'+clean.toLowerCase()+'" onclick="lookupWordTooltip(this,event)">'+w+'</span>';
      }
      return w;
    }).join('');
    exEl.style.visibility='visible';
  } else if(card.ex && card.cardMode==='vn-en'){
    exEl.textContent=card.ex;
    exEl.style.visibility='hidden';
  } else {
    exEl.textContent='';
    exEl.style.visibility='hidden';
  }
  document.getElementById('feedback').textContent='';
  document.getElementById('feedback').className='feedback';
  inp.value='';inp.className='';inp.disabled=false;
  updateBookmarkBtn();
  document.getElementById('btn-check').disabled=false;
  updateProgress();updateStats();
  setTimeout(()=>inp.focus(),80);
}


// Text-to-speech
export function speakWord(){
  if(!window.speechSynthesis) return;
  const card = deck[idx];
  if(!card) return;
  const word = card.cardMode==='en-vn' ? card.en : card.en; // always read EN
  const btn  = document.getElementById('btn-speak');

  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(word);
  utter.lang  = 'en-US';
  utter.rate  = 0.85;  // slightly slower for clarity
  utter.pitch = 1;

  utter.onstart = ()=> btn.classList.add('speaking');
  utter.onend   = ()=> btn.classList.remove('speaking');
  utter.onerror = ()=> btn.classList.remove('speaking');

  window.speechSynthesis.speak(utter);
}
window.speakWord = speakWord;

// Also reveal English pronunciation in VN→EN mode after answering
export function speakAfterAnswer(word){
  if(!window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(word);
  utter.lang  = 'en-US';
  utter.rate  = 0.85;
  window.speechSynthesis.speak(utter);
}

// ── BADGE DEFINITIONS ─────────────────────────────────────────────
export const BADGES = [
  {id:'first_correct',  icon:'🎯', name:'Bước đầu tiên',      desc:'Trả lời đúng từ đầu tiên',         check:(u)=>u.totalCorrect>=1},
  {id:'combo5',         icon:'🔥', name:'Bốc lửa x5',         desc:'Đúng 5 từ liên tiếp',              check:(u)=>u.bestCombo>=5},
  {id:'combo10',        icon:'⚡', name:'Sấm sét x10',        desc:'Đúng 10 từ liên tiếp',             check:(u)=>u.bestCombo>=10},
  {id:'combo20',        icon:'💥', name:'Vô địch x20',        desc:'Đúng 20 từ liên tiếp',             check:(u)=>u.bestCombo>=20},
  {id:'correct50',      icon:'📚', name:'Chăm chỉ',           desc:'Tổng cộng đúng 50 từ',             check:(u)=>u.totalCorrect>=50},
  {id:'correct100',     icon:'💪', name:'Cần cù',             desc:'Tổng cộng đúng 100 từ',            check:(u)=>u.totalCorrect>=100},
  {id:'correct500',     icon:'🏅', name:'Học sinh giỏi',      desc:'Tổng cộng đúng 500 từ',            check:(u)=>u.totalCorrect>=500},
  {id:'correct1000',    icon:'🏆', name:'TOEIC Master',       desc:'Tổng cộng đúng 1000 từ',           check:(u)=>u.totalCorrect>=1000},
  {id:'streak3',        icon:'🌱', name:'Khởi đầu tốt',       desc:'Streak 3 ngày liên tiếp',          check:(u)=>u.streak>=3},
  {id:'streak7',        icon:'🔆', name:'Tuần lễ vàng',       desc:'Streak 7 ngày liên tiếp',          check:(u)=>u.streak>=7},
  {id:'streak30',       icon:'👑', name:'Kiên trì vô địch',   desc:'Streak 30 ngày liên tiếp',         check:(u)=>u.streak>=30},
  {id:'perfect_session',icon:'💯', name:'Hoàn hảo',           desc:'Đúng 100% trong 1 buổi (≥20 thẻ)', check:(u)=>u.hadPerfectSession},
];

// ── COMBO STATE ───────────────────────────────────────────────────
export let currentCombo = 0;
export let bestComboSession = 0;

export function updateCombo(correct){
  if(correct){
    currentCombo++;
    if(currentCombo > bestComboSession) bestComboSession = currentCombo;
    if(currentCombo >= 3){
      const el = document.getElementById('combo-display');
      if(el){
        el.style.display = 'block';
        el.textContent = '🔥 Combo x' + currentCombo + '!';
        el.classList.remove('combo-pop');
        void el.offsetWidth;
        el.classList.add('combo-pop');
      }
    }
  } else {
    currentCombo = 0;
    const el = document.getElementById('combo-display');
    if(el){ el.style.display = 'none'; el.textContent = ''; }
  }
}

export function resetCombo(){
  currentCombo = 0;
  const el = document.getElementById('combo-display');
  if(el){ el.style.display='none'; el.textContent=''; }
}

// ── BADGE TOAST ───────────────────────────────────────────────────
export let toastQueue = [];
export let toastBusy  = false;

export function showBadgeToast(badge){
  toastQueue.push(badge);
  if(!toastBusy) processToastQueue();
}

export function processToastQueue(){
  if(!toastQueue.length){ toastBusy=false; return; }
  toastBusy = true;
  const badge = toastQueue.shift();
  const toast  = document.getElementById('badge-toast');
  document.getElementById('badge-toast-icon').textContent = badge.icon;
  document.getElementById('badge-toast-name').textContent = badge.name + ' — ' + badge.desc;
  toast.classList.add('show');
  setTimeout(()=>{
    toast.classList.remove('show');
    setTimeout(processToastQueue, 400);
  }, 3000);
}

// ── BADGE CHECK & SAVE ────────────────────────────────────────────
export async function checkAndAwardBadges(extraData={}){
  if(!currentUser) return;
  try{
    const userRef  = doc(db,'users',currentUser.username);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.data() || {};

    // Use in-session stats + cumulative from ranking_all
    // totalCorrect: use correctCount (current session) + what's already in ranking_all
    let allTimeCorrect = correctCount; // minimum: current session
    try{
      const allSnap = await getDoc(doc(db,'ranking_all',currentUser.username));
      if(allSnap.exists()) allTimeCorrect = allSnap.data().correct || correctCount;
    } catch(e){}

    const newBestCombo = Math.max(userData.bestCombo||0, extraData.bestCombo||0, bestComboSession);
    const isPerfect    = userData.hadPerfectSession || extraData.hadPerfectSession || false;

    const checkData = {
      totalCorrect:      allTimeCorrect,
      streak:            userData.streak || 0,
      bestCombo:         newBestCombo,
      hadPerfectSession: isPerfect,
    };

    const earnedSoFar = Array.isArray(userData.badges) ? userData.badges : [];
    const newBadges   = [];

    for(const badge of BADGES){
      if(earnedSoFar.includes(badge.id)) continue;
      if(badge.check(checkData)){
        newBadges.push(badge.id);
        showBadgeToast(badge);
      }
    }

    // Always update bestCombo and hadPerfectSession; add new badges with arrayUnion
    const updatePayload = {
      bestCombo: newBestCombo,
      hadPerfectSession: isPerfect,
    };
    if(newBadges.length > 0) updatePayload.badges = arrayUnion(...newBadges);
    
    await updateDoc(userRef, updatePayload);
  } catch(e){ console.error('Badge check error:', e); }
}

// ── RENDER BADGES in Summary ──────────────────────────────────────
export async function renderBadges(){
  const grid = document.getElementById('badge-grid');
  if(!grid || !currentUser) return;
  try{
    const userSnap = await getDoc(doc(db,'users',currentUser.username));
    const earned   = userSnap.data()?.badges || [];
    grid.innerHTML  = BADGES.map(b=>`
      <div class="badge-item ${earned.includes(b.id)?'earned':'locked'}"
        onclick="showBadgePopup('${b.icon}','${b.name}','${b.desc}',${earned.includes(b.id)})"
        style="cursor:pointer;">
        <span class="badge-icon">${b.icon}</span>
        <span class="badge-label">${b.name}</span>
      </div>`).join('');
  } catch(e){ grid.innerHTML = '<div style="color:var(--muted);font-size:12px">Lỗi tải huy hiệu.</div>'; }
}
export function checkAnswer(){
  if(answered){nextCard();return;}
  const inp=document.getElementById('answer-input');
  const userAns=inp.value.trim();
  if(!userAns)return;
  const card=deck[idx];
  const ok=acceptableMatch(userAns,card,card.cardMode);
  answered=true;inp.disabled=true;document.getElementById('btn-check').disabled=true;
  document.getElementById('card-example').style.visibility='visible';
  const fc=document.getElementById('flashcard'),fb=document.getElementById('feedback');
  history.push({en:card.en,vn:card.vn,topic:card.topic,cardMode:card.cardMode,userAnswer:userAns,ok});
  if(ok){
    fc.className='flashcard correct';inp.className='correct';
    fb.textContent='✓ Chính xác!';fb.className='feedback correct';correctCount++;
    if(card.cardMode==='vn-en') speakAfterAnswer(card.en);
    updateCombo(true);
    wrongStreak=0; // reset wrong streak on correct
  }else{
    const allAns=card.cardMode==='en-vn'?[card.vn,...(card.vn_alt||[])]:[card.en,...(card.en_alt||[])];
    fc.className='flashcard wrong';inp.className='wrong';
    fb.textContent=`✗ Sai. Đáp án: "${allAns.join(' / ')}"`;fb.className='feedback wrong';wrongCount++;
    updateCombo(false);
    wrongStreak++;
    checkWrongStreak();
  }
  updateStats();
  document.getElementById('btn-skip').textContent='Tiếp tục →';
}
window.checkAnswer=checkAnswer;

export function nextCard(){idx++;renderCard();}
export function prevCard(){if(idx>0){idx--;renderCard();}}
export function skipCard(){
  if(answered){nextCard();return;}
  skipCount++;idx++;updateStats();renderCard();
}
window.prevCard=prevCard;
window.skipCard=skipCard;

export function updateProgress(){
  const pct=deck.length?Math.round((idx/deck.length)*100):0;
  document.getElementById('progress-fill').style.width=pct+'%';
  document.getElementById('prog-text').textContent=`Thẻ ${idx} / ${deck.length}`;
  document.getElementById('prog-pct').textContent=pct+'%';
}
export function updateProgressDisplay(){
  // Update count display without re-rendering the current card
  updateProgress();
  const counterEl = document.getElementById('card-counter');
  if(counterEl && deck.length>0) counterEl.textContent=(idx+1)+' / '+deck.length;
}
export function updateStats(){
  document.getElementById('stat-correct')&&(document.getElementById('stat-correct').textContent=`${correctCount} đúng`);
  document.getElementById('stat-wrong')&&(document.getElementById('stat-wrong').textContent=`${wrongCount} sai`);
  // Save session to localStorage every 5 answers
  if((correctCount+wrongCount) > 0 && (correctCount+wrongCount) % 5 === 0){
    saveLastSessionLocal();
  }
  // Realtime badge check for key milestones
  if(currentUser && (correctCount===1 || bestComboSession===5 || bestComboSession===10 || bestComboSession===20)){
    checkAndAwardBadges({bestCombo:bestComboSession});
  }
  // Auto-save every 10 correct answers (delta only)
  if(currentUser && correctCount > 0 && correctCount % 10 === 0){
    const deltaC = correctCount - savedCorrect;
    const deltaW = wrongCount  - savedWrong;
    if(deltaC > 0){
      const pct = (deltaC+deltaW)>0 ? Math.round(deltaC/(deltaC+deltaW)*100) : 0;
      saveSession(deltaC, deltaW, 0, pct).then(()=>{
        savedCorrect = correctCount;
        savedWrong   = wrongCount;
        checkAndAwardBadges({bestCombo: bestComboSession});
      }).catch(()=>{});
    }
  }
}

export async function showScore(){
  document.getElementById('practice-panel').style.display='none';
  const total=correctCount+wrongCount+skipCount;
  const pct=total?Math.round((correctCount/total)*100):0;
  document.getElementById('score-pct').textContent=pct+'%';
  document.getElementById('sc-correct').textContent=correctCount+' đúng';
  document.getElementById('sc-wrong').textContent=wrongCount+' sai';
  document.getElementById('sc-skip').textContent=skipCount+' bỏ qua';
  document.getElementById('score-panel').classList.add('show');
  document.getElementById('progress-fill').style.width='100%';
  document.getElementById('prog-text').textContent='Hoàn thành!';

  // Save session to Firestore
  if(currentUser && (correctCount+wrongCount)>0){
    document.getElementById('score-save-msg').textContent='Đang lưu kết quả...';
    try{
      await saveSession(correctCount, wrongCount, skipCount, pct);
      document.getElementById('score-save-msg').textContent='✓ Đã lưu vào bảng xếp hạng!';
      savedCorrect = correctCount; savedWrong = wrongCount;
      saveLastSession();
      // Check badges with session data
      const isPerfect = wrongCount===0 && (correctCount+wrongCount)>=20;
      checkAndAwardBadges({bestCombo: bestComboSession, hadPerfectSession: isPerfect});
      loadUserStreak();
    }catch(e){
      document.getElementById('score-save-msg').textContent='Lưu thất bại, kiểm tra mạng.';
    }
  }
}

export function restart(){
  document.getElementById('practice-panel').style.display='';
  document.getElementById('score-panel').classList.remove('show');
  history=[];buildDeck();mixMyWordsIntoDeck();renderCard();
}
window.restart=restart;

// ── Save session to Firestore ─────────────────────────────────────
export async function saveSession(correct, wrong, skip, pct) {
  const week  = getWeekKey();
  const month = getVNMonth();
  const username = currentUser.username;

  // Save raw session
  const sessionRef = doc(collection(db,'sessions'));
  await setDoc(sessionRef, {
    username, displayName: currentUser.displayName,
    correct, wrong, skip, pct,
    week, month, createdAt: serverTimestamp()
  });

  // Update weekly stats
  const weekRef = doc(db,'ranking_week', `${week}_${username}`);
  const weekSnap = await getDoc(weekRef);
  if(weekSnap.exists()){
    await updateDoc(weekRef,{
      correct: increment(correct),
      wrong:   increment(wrong),
      total:   increment(correct+wrong),
      sessions: increment(1),
    });
    const d = weekSnap.data();
    const newCorrect = (d.correct||0)+correct;
    const newTotal   = (d.correct||0)+(d.wrong||0)+correct+wrong;
    await updateDoc(weekRef,{ pct: newTotal?Math.round(newCorrect/newTotal*100):0 });
  } else {
    await setDoc(weekRef,{
      username, displayName: currentUser.displayName,
      week, correct, wrong, skip, pct, total: correct+wrong, sessions:1
    });
  }

  // Update monthly stats
  const monthRef = doc(db,'ranking_month', `${month}_${username}`);
  const monthSnap = await getDoc(monthRef);
  if(monthSnap.exists()){
    await updateDoc(monthRef,{
      correct: increment(correct),
      wrong:   increment(wrong),
      total:   increment(correct+wrong),
      sessions: increment(1),
    });
    const d = monthSnap.data();
    const newCorrect = (d.correct||0)+correct;
    const newTotal   = (d.correct||0)+(d.wrong||0)+correct+wrong;
    await updateDoc(monthRef,{ pct: newTotal?Math.round(newCorrect/newTotal*100):0 });
  } else {
    await setDoc(monthRef,{
      username, displayName: currentUser.displayName,
      month, correct, wrong, skip, pct, total: correct+wrong, sessions:1
    });
  }

  // Update all-time stats
  const allRef = doc(db,'ranking_all', username);
  const allSnap = await getDoc(allRef);
  if(allSnap.exists()){
    await updateDoc(allRef,{
      correct: increment(correct),
      wrong:   increment(wrong),
      total:   increment(correct+wrong),
      sessions: increment(1),
    });
    const d = allSnap.data();
    const newCorrect = (d.correct||0)+correct;
    const newTotal   = (d.correct||0)+(d.wrong||0)+correct+wrong;
    await updateDoc(allRef,{ pct: newTotal?Math.round(newCorrect/newTotal*100):0 });
  } else {
    await setDoc(allRef,{
      username, displayName: currentUser.displayName,
      correct, wrong, skip, pct, total: correct+wrong, sessions:1
    });
  }
}

export let rankPeriod = 'week';
export function setRankPeriod(p,btn){
  rankPeriod=p;
  document.querySelectorAll('.rank-period-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  loadRanking();
}
window.setRankPeriod=setRankPeriod;

export async function loadRanking(){
  const tableEl=document.getElementById('rank-table');
  tableEl.innerHTML='<div class="rank-loading">Đang tải...</div>';
  try{
    // Handle streak tab separately
    if(rankPeriod==='streak'){
      const snap=await getDocs(collection(db,'users'));
      const streakRows=[];
      snap.forEach(d=>{
        const u=d.data();
        if(!u.isAdmin) streakRows.push({username:u.username,displayName:u.displayName||u.username,streak:u.streak||0,lastStudyDay:u.lastStudyDay||''});
      });
      streakRows.sort((a,b)=>b.streak-a.streak);
      if(streakRows.length===0){tableEl.innerHTML='<div class="rank-empty">Chưa có dữ liệu streak.</div>';return;}
      tableEl.innerHTML='<div class="rank-section-title">Streak - So ngay hoc lien tiep</div>'+
        streakRows.map((r,i)=>{
          const rank=i+1;
          const isMe=r.username===currentUser.username;
          const medal=rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':'';
          const numClass=rank===1?'r1':rank===2?'r2':rank===3?'r3':'';
          const rowClass=`rank-row${isMe?' me':''}${rank<=3?` rank-${rank}`:''}`;
          const today=getVNDate(0);
          const yesterday=getVNDate(-1);
          const active=r.lastStudyDay===today||r.lastStudyDay===yesterday;
          return `<div class="${rowClass}">
            <div class="rank-num ${numClass}">${medal||rank}</div>
            <div class="rank-info">
              <div class="rank-name">${r.displayName}${isMe?'<span class="you-badge">Bạn</span>':''}</div>
              <div class="rank-streak" style="color:${active?'var(--yellow)':'var(--muted)'}">${r.streak>0?r.streak+' ngày liên tiếp':'Chưa có streak'}</div>
            </div>
            <div class="rank-stats">
              <div class="rank-correct" style="font-size:18px;">${r.streak>0?r.streak+' 🔥':'-'}</div>
            </div>
          </div>`;
        }).join('');
      return;
    }

    let col, rows=[];
    if(rankPeriod==='week'){
      const week=getWeekKey();
      const q=query(collection(db,'ranking_week'),where('week','==',week));
      const snap=await getDocs(q);
      snap.forEach(d=>rows.push(d.data()));
    } else if(rankPeriod==='month'){
      const month=getVNMonth();
      const q=query(collection(db,'ranking_month'),where('month','==',month));
      const snap=await getDocs(q);
      snap.forEach(d=>rows.push(d.data()));
    } else {
      const snap=await getDocs(collection(db,'ranking_all'));
      snap.forEach(d=>rows.push(d.data()));
    }

    // Sort: correct DESC, then pct DESC
    rows.sort((a,b)=>(b.correct-a.correct)||((b.pct||0)-(a.pct||0)));

    if(rows.length===0){
      tableEl.innerHTML='<div class="rank-empty">Chưa có dữ liệu tuần này.<br>Hãy luyện tập để lên bảng xếp hạng!</div>';
      return;
    }

    // Get streaks
    const userDocs = await Promise.all(rows.map(r=>getDoc(doc(db,'users',r.username))));
    const streakMap = {};
    userDocs.forEach((d,i)=>{ streakMap[rows[i].username]=d.data()?.streak||0; });

    const periodLabel = rankPeriod==='week'?'Tuần này':rankPeriod==='month'?'Tháng này':'Tổng cộng';
    tableEl.innerHTML = `<div class="rank-section-title">${periodLabel} — Xếp theo số từ đúng</div>` +
      rows.map((r,i)=>{
        const rank=i+1;
        const isMe=r.username===currentUser.username;
        const medal=rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':'';
        const numClass=rank===1?'r1':rank===2?'r2':rank===3?'r3':'';
        const rowClass=`rank-row${isMe?' me':''}${rank<=3?` rank-${rank}`:''}`;
        const streak=streakMap[r.username]||0;
        return `<div class="${rowClass}">
          <div class="rank-num ${numClass}">${medal||rank}</div>
          <div class="rank-info">
            <div class="rank-name">${r.displayName||r.username}${isMe?'<span class="you-badge">Bạn</span>':''}</div>
            ${streak>0?`<div class="rank-streak">🔥 ${streak} ngày liên tiếp</div>`:''}
          </div>
          <div class="rank-stats">
            <div class="rank-correct">${r.correct} đúng / ${r.total||(r.correct+(r.wrong||0))} thẻ</div>
            <div class="rank-pct">${r.pct||0}%</div>
          </div>
          ${currentUser?.isAdmin?`<button onclick="deleteUserRanking('${r.username}','${r.displayName||r.username}','${rankPeriod}')" style="background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:18px;padding:2px 4px;flex-shrink:0;" title="Xóa BXH">🗑️</button>`:''}
        </div>`;
      }).join('');

  } catch(e){
    tableEl.innerHTML='<div class="rank-empty">Lỗi tải dữ liệu.</div>';
    console.error(e);
  }
}

// ── Summary ───────────────────────────────────────────────────────
export function renderSummary(){
  // Show session info
  const infoEl = document.getElementById('sum-session-info');
  if(infoEl){
    if(history.length===0){
      infoEl.textContent='';
    } else {
      const today = new Date().toISOString().slice(0,10);
      infoEl.textContent = '📋 Buổi học hôm nay · '+history.length+' thẻ đã làm';
    }
  }
  const ok=history.filter(h=>h.ok).length;
  const fail=history.filter(h=>!h.ok).length;
  const total=history.length;
  document.getElementById('s-total').textContent=total;
  document.getElementById('s-correct').textContent=ok;
  document.getElementById('s-wrong').textContent=fail;
  document.getElementById('s-pct').textContent=total?Math.round(ok/total*100)+'%':'0%';
  document.getElementById('btn-retry-wrong').disabled=fail===0;
  document.getElementById('btn-retry-correct').disabled=(ok+fail)===0;
  const filtered=sumFilter==='all'?history:history.filter(h=>sumFilter==='ok'?h.ok:!h.ok);
  const list=document.getElementById('sum-list');
  if(filtered.length===0){
    list.innerHTML=`<div class="sum-empty">${history.length===0?'Chưa có từ nào. Quay lại luyện tập!':'Không có từ nào.'}</div>`;
    return;
  }
  list.innerHTML=filtered.map((h,i)=>{
    const dispWord=h.cardMode==='en-vn'?h.en:h.vn;
    const dispMeaning=h.cardMode==='en-vn'?h.vn:h.en;
    const ansHtml=!h.ok
      ?`<span class="wrong-ans">Bạn: "${h.userAnswer}"</span><span class="right-ans">Đúng: "${dispMeaning}"</span>`
      :`<span>${dispMeaning}</span>`;
    return `<div class="sum-row ${h.ok?'ok':'fail'}">
      <div class="sum-num">${history.indexOf(h)+1}</div>
      <div class="sum-word">${dispWord}<small>${h.topic}</small></div>
      <div class="sum-ans">${ansHtml}</div>
      <div class="sum-icon">${h.ok?'✅':'❌'}</div>
    </div>`;
  }).join('');
}
export function filterSum(f,btn){
  sumFilter=f;
  document.querySelectorAll('.sum-filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');renderSummary();
}
export function retryCorrect(){
  const correctCards=[...history]; // all answered cards (both correct and wrong)
  if(!correctCards.length)return;
  document.querySelectorAll('.top-tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.top-tab')[0].classList.add('active');
  document.querySelectorAll('#flashcard-subnav .tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('#flashcard-subnav .tab-btn')[0].classList.add('active');
  document.querySelectorAll('[id$="-panel"]').forEach(el=>el.style.display='none');
  document.getElementById('practice-panel').style.display='';
  document.getElementById('flashcard-subnav').style.display='flex';
  deck=correctCards.map(h=>({...ALL_WORDS.find(w=>w.en===h.en)||correctCards[0],cardMode:h.cardMode}));
  for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
  idx=0;correctCount=0;wrongCount=0;skipCount=0;history=[];
  updateStats();renderCard();
}
window.retryCorrect=retryCorrect;

export function retryWrong(){
  const wrongCards=history.filter(h=>!h.ok);
  if(!wrongCards.length)return;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-btn')[0].classList.add('active');
  document.getElementById('practice-panel').style.display='';
  document.getElementById('sum-panel').style.display='none';
  document.getElementById('rank-panel').style.display='none';
  document.getElementById('admin-panel').style.display='none';
  document.getElementById('score-panel').style.display='none';
  deck=wrongCards.map(h=>({...ALL_WORDS.find(w=>w.en===h.en)||wrongCards[0],cardMode:h.cardMode}));
  for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
  idx=0;correctCount=0;wrongCount=0;skipCount=0;history=[];savedCorrect=0;savedWrong=0;bestComboSession=0;resetCombo();wrongStreak=0;
  updateStats();renderCard();
}
window.filterSum=filterSum;
window.retryWrong=retryWrong;

// ── Admin ─────────────────────────────────────────────────────────
export const FUN_MESSAGES = [
  { at:3, emoji:'🐔', msg:'Gà, sai gì dữ dẫy haizzz :D' },
  { at:5, emoji:'😤', msg:'Giỡn mặt hả???' },
  { at:8, emoji:'💀', msg:'Thua, đánh ăn đấm, ôn lại đi' },
];
export let funToastTimer = null;

export function showFunToast(emoji, msg){
  clearTimeout(funToastTimer);
  document.getElementById('fun-emoji').textContent = emoji;
  document.getElementById('fun-msg').textContent   = msg;
  const toast = document.getElementById('fun-toast');
  toast.classList.add('show');
  funToastTimer = setTimeout(()=>toast.classList.remove('show'), 4000);
}
export function closeFunToast(){
  clearTimeout(funToastTimer);
  document.getElementById('fun-toast').classList.remove('show');
}
window.closeFunToast = closeFunToast;

export function checkWrongStreak(){
  const match = FUN_MESSAGES.find(m => m.at === wrongStreak);
  if(match) showFunToast(match.emoji, match.msg);
}


// ── TIME FORMAT HELPERS ───────────────────────────────────────────
export let bookmarks = new Set(); // Set of bookmarked word 'en' values

export async function loadBookmarks(){
  if(!currentUser) return;
  try{
    // Try localStorage first
    const lsKey = 'toeic_bm_'+currentUser.username;
    const lsVal = localStorage.getItem(lsKey);
    if(lsVal) bookmarks = new Set(JSON.parse(lsVal));
    // Sync from Firestore in background
    getDoc(doc(db,'users',currentUser.username)).then(snap=>{
      const bms = snap.data()?.bookmarks || [];
      if(bms.length){
        bookmarks = new Set(bms);
        localStorage.setItem(lsKey, JSON.stringify(bms));
      }
      updateBookmarkChip();
    }).catch(()=>{});
  }catch(e){}
  updateBookmarkChip();
}

export async function toggleBookmark(){
  const card = deck[idx];
  if(!card || !currentUser) return;
  const word = card.en;
  const btn = document.getElementById('btn-bookmark');
  const wasBookmarked = bookmarks.has(word);
  if(wasBookmarked){
    bookmarks.delete(word);
    btn.textContent = '☆';
    btn.style.color = '';
    // If in bookmark mode, remove card and move to next
    if(activeTopic==='mywords'){
    const seen2=new Set();
    pool=myWords.map(w=>({topic:'Từ riêng',en:w.en,pos:'',en_alt:[],vn:w.vn,vn_alt:[],ex:w.ex||''}))
      .filter(w=>{ if(!seen2.has(w.en)){seen2.add(w.en);return true;}return false; });
  } else if(activeTopic==='bookmarks'){
      updateBookmarkChip();
      const arr2 = [...bookmarks];
      const lsKey2 = 'toeic_bm_'+currentUser.username;
      localStorage.setItem(lsKey2, JSON.stringify(arr2));
      updateDoc(doc(db,'users',currentUser.username),{bookmarks: arr2}).catch(()=>{});
      // Rebuild deck without this card
      deck = deck.filter(d=>d.en !== word);
      if(idx >= deck.length) idx = Math.max(0, deck.length-1);
      renderCard();
      return;
    }
  } else {
    bookmarks.add(word);
    btn.textContent = '⭐';
    btn.style.color = '#FFD700';
    showBadgeToast({icon:'⭐', name:'Đã đánh dấu "'+word+'"', desc:'Vào "⭐ Đã đánh dấu" để ôn lại'});
  }
  updateBookmarkChip();
  // Save
  const arr = [...bookmarks];
  const lsKey = 'toeic_bm_'+currentUser.username;
  localStorage.setItem(lsKey, JSON.stringify(arr));
  updateDoc(doc(db,'users',currentUser.username),{bookmarks: arr}).catch(()=>{});
}
window.toggleBookmark = toggleBookmark;

export function updateBookmarkChip(){
  const chip = document.getElementById('bookmark-chip');
  if(chip) chip.innerHTML = '⭐ Đã đánh dấu' + (bookmarks.size > 0 ? ' ('+bookmarks.size+')' : '');
}

export function updateBookmarkBtn(){
  const card = deck[idx];
  const btn = document.getElementById('btn-bookmark');
  if(!btn || !card) return;
  if(bookmarks.has(card.en)){
    btn.textContent = '⭐'; btn.style.color = '#FFD700';
  } else {
    btn.textContent = '☆'; btn.style.color = '';
  }
}

// ── WORD CLICK TOOLTIP ────────────────────────────────────────────
export let tooltipTimeout = null;

export async function lookupWordTooltip(el, event){
  event.stopPropagation();
  const word = el.dataset.word;
  if(!word) return;
  // Skip stop words
  if(STOP_WORDS.has(word)){ return; }

  const tt = document.getElementById('word-tooltip');
  const ttWord = document.getElementById('tt-word');
  const ttPos = document.getElementById('tt-pos');
  const ttMeaning = document.getElementById('tt-meaning');
  const ttEn = document.getElementById('tt-en');

  // Set content first, then position
  ttWord.textContent = word;
  ttPos.textContent = '';
  ttMeaning.textContent = 'Đang tra...';
  ttEn.textContent = '';

  // Show to measure, then reposition
  tt.style.display = 'block';
  tt.style.opacity = '0';

  // Position after it's visible (so getBoundingClientRect works)
  requestAnimationFrame(()=>{
    const rect = el.getBoundingClientRect();
    const ttRect = tt.getBoundingClientRect();
    let top = rect.bottom + window.scrollY + 8;
    let left = rect.left + window.scrollX;
    if(left + ttRect.width + 8 > window.innerWidth) left = window.innerWidth - ttRect.width - 12;
    if(left < 8) left = 8;
    tt.style.top = top + 'px';
    tt.style.left = left + 'px';
    tt.style.opacity = '1';
  });

  // 1. Check TOEIC vocab first (instant)
  // Try multiple base forms for better matching
  const tryBases = [word];
  if(word.endsWith('ies'))   tryBases.push(word.slice(0,-3)+'y');
  if(word.endsWith('ves'))   tryBases.push(word.slice(0,-3)+'f');
  if(word.endsWith('es'))    tryBases.push(word.slice(0,-2));
  if(word.endsWith('s'))     tryBases.push(word.slice(0,-1));
  if(word.endsWith('ing'))   tryBases.push(word.slice(0,-3), word.slice(0,-3)+'e');
  if(word.endsWith('ed'))    tryBases.push(word.slice(0,-2), word.slice(0,-1));
  if(word.endsWith('er'))    tryBases.push(word.slice(0,-2));
  if(word.endsWith('ly'))    tryBases.push(word.slice(0,-2));
  // Double consonant: submitted→submit, stopped→stop, controlled→control
  if(word.endsWith('tted'))  tryBases.push(word.slice(0,-3));
  if(word.endsWith('pped'))  tryBases.push(word.slice(0,-3));
  if(word.endsWith('rred'))  tryBases.push(word.slice(0,-3));
  if(word.endsWith('mmed'))  tryBases.push(word.slice(0,-3));
  if(word.endsWith('nned'))  tryBases.push(word.slice(0,-3));
  if(word.endsWith('lled'))  tryBases.push(word.slice(0,-3));
  if(word.endsWith('tting')) tryBases.push(word.slice(0,-4));
  const base = tryBases[1] || word;

  const found = ALL_WORDS.find(w => {
    const en = w.en.toLowerCase().split('/')[0].trim().replace(/\s*\([^)]+\)/g,'').trim();
    return tryBases.includes(en) || tryBases.includes(w.en.toLowerCase());
  });

  if(found){
    ttPos.textContent = found.pos || '';
    const vns = [found.vn,...(found.vn_alt||[])].filter(Boolean).slice(0,3);
    ttMeaning.textContent = vns.join(' · ');
    ttEn.textContent = '📚 TOEIC Vocabulary';
    return;
  }

  // 2. Check COMMON_WORDS + EXTRA_DICT (instant, no API)
  const common = COMMON_WORDS.find(w => tryBases.includes(w.w));
  if(common){
    ttPos.textContent = common.p || '';
    const vns2 = [common.v,...(common.a||[])].filter(Boolean).slice(0,3);
    ttMeaning.textContent = vns2.join(' · ');
    ttEn.textContent = '';
    return;
  }
  // Check EXTRA_DICT
  const extraVn = tryBases.map(b=>EXTRA_DICT[b]).find(v=>v);
  if(extraVn){
    ttPos.textContent = '';
    ttMeaning.textContent = extraVn;
    ttEn.textContent = '';
    return;
  }

  // 3. Try Free Dictionary API
  try{
    const res = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/'+encodeURIComponent(word));
    if(res.ok){
      const data = await res.json();
      const entry = data[0];
      const meaning = entry?.meanings?.[0];
      const def = meaning?.definitions?.[0];
      ttPos.textContent = meaning?.partOfSpeech || '';
      ttMeaning.textContent = def?.definition?.slice(0,90) || '';
      ttEn.textContent = '';
    } else {
      ttMeaning.textContent = 'Không tìm thấy';
      ttEn.textContent = '';
    }
  }catch(e){
    ttMeaning.textContent = '';
    ttEn.textContent = '';
  }

  clearTimeout(tooltipTimeout);
  tooltipTimeout = setTimeout(()=>{ tt.style.display='none'; }, 4000);
}
window.lookupWordTooltip = lookupWordTooltip;

// Hide tooltip when clicking elsewhere
document.addEventListener('click', (e)=>{
  if(!e.target.classList.contains('clickable-word')){
    const tt = document.getElementById('word-tooltip');
    if(tt) tt.style.display='none';
  }
});

// ── BADGE POPUP ────────────────────────────────────────────────────
export function showBadgePopup(icon, name, desc, earned){
  document.getElementById('bp-icon').textContent   = icon;
  document.getElementById('bp-name').textContent   = name;
  document.getElementById('bp-desc').textContent   = desc;
  const statusEl = document.getElementById('bp-status');
  statusEl.textContent  = earned ? '✅ Đã đạt được' : '🔒 Chưa mở khóa';
  statusEl.className    = 'badge-popup-status ' + (earned ? 'earned' : 'locked');
  document.getElementById('badge-popup').classList.add('show');
}
window.showBadgePopup = showBadgePopup;

export function closeBadgePopup(){
  document.getElementById('badge-popup').classList.remove('show');
}
window.closeBadgePopup = closeBadgePopup;

// Close on backdrop tap
document.addEventListener('click', e=>{
  const popup = document.getElementById('badge-popup');
  if(popup && e.target === popup) popup.classList.remove('show');
});

// ── TỪ RIÊNG (MY WORDS) ───────────────────────────────────────────
export let myWords = []; // [{en, vn, ex, id}]

export async function loadMyWords(){
  if(!currentUser) return;
  try{
    const lsKey = 'toeic_mw_'+currentUser.username;
    const ls = localStorage.getItem(lsKey);
    if(ls) myWords = JSON.parse(ls);
    // Sync from Firestore
    getDoc(doc(db,'users',currentUser.username)).then(snap=>{
      const fw = snap.data()?.myWords;
      if(fw && fw.length){ myWords = fw; localStorage.setItem(lsKey, JSON.stringify(fw)); }
      updateMyWordChip();
    }).catch(()=>{});
  }catch(e){ myWords=[]; }
  updateMyWordChip();
}

export async function saveMyWords(){
  if(!currentUser) return;
  const lsKey = 'toeic_mw_'+currentUser.username;
  localStorage.setItem(lsKey, JSON.stringify(myWords));
  updateDoc(doc(db,'users',currentUser.username),{myWords}).catch(()=>{});
}

export function updateMyWordChip(){
  const chip = document.getElementById('myword-chip');
  if(chip) chip.innerHTML = '📝 Từ riêng' + (myWords.length>0?' ('+myWords.length+')':'');
}

// ── Kiểm tra chính tả: đối chiếu từ điển tiếng Anh thật (Free Dictionary API),
// không chỉ so trong kho ~1500 từ TOEIC nội bộ (kho nhỏ đó chỉ dùng để GỢI Ý sửa,
// không dùng để KẾT LUẬN đúng/sai — tránh báo nhầm các từ đúng nhưng ngoài kho).
let _spellVocab = null;
function getSpellVocab(){
  if(_spellVocab) return _spellVocab;
  const set = new Set();
  ALL_WORDS.forEach(w=>set.add(w.en.toLowerCase()));
  COMMON_WORDS.forEach(w=>set.add(w.w.toLowerCase()));
  Object.keys(EXTRA_DICT).forEach(w=>set.add(w.toLowerCase()));
  _spellVocab = set;
  return set;
}

const _knownWordCache = new Map();
async function isKnownWord(word){
  const w = word.toLowerCase();
  if(getSpellVocab().has(w)) return true;
  if(_knownWordCache.has(w)) return _knownWordCache.get(w);
  let known = true;
  try{
    const res = await fetch(DICT_API + encodeURIComponent(w));
    known = res.ok;
  }catch(e){
    known = true; // lỗi mạng/API thì bỏ qua, không báo sai oan
  }
  _knownWordCache.set(w, known);
  return known;
}

function findClosestWord(word){
  const w = word.trim().toLowerCase();
  if(!w || w.length < 4) return null;
  const vocab = getSpellVocab();
  if(vocab.has(w)) return null;
  let best=null, bestDist=Infinity;
  for(const v of vocab){
    if(Math.abs(v.length-w.length) > 2) continue;
    const d = levenshtein(w, v);
    if(d < bestDist){ bestDist=d; best=v; if(bestDist===1) break; }
  }
  const threshold = w.length <= 5 ? 1 : 2;
  return (best && bestDist>0 && bestDist<=threshold) ? best : null;
}

// Kiểm tra cả cụm (có thể nhiều từ, ví dụ "take park in") — kiểm tra TỪNG từ trong cụm
// bằng từ điển thật, chỉ những từ không tồn tại trong từ điển mới bị coi là sai.
// Trả về null nếu cả cụm đều là từ tiếng Anh hợp lệ.
async function checkPhraseSpelling(phrase){
  const norm = phrase.trim().toLowerCase().replace(/\s+/g,' ');
  const tokens = norm.split(' ');

  if(tokens.length === 1){
    // Từ đơn: kiểm tra qua từ điển thật, bỏ qua từ nối/giới từ (STOP_WORDS)
    const clean = tokens[0].replace(/[^a-zA-Z']/g,'');
    if(clean.length < 4 || STOP_WORDS.has(clean)) return null;
    const known = await isKnownWord(clean);
    if(known) return null;
    const suggestion = findClosestWord(clean);
    return { suggestion };
  }

  // Cụm nhiều từ: so trước với kho cụm động từ/collocation quen thuộc (KNOWN_PHRASES),
  // vì đây là cách duy nhất bắt được lỗi kiểu "take park in" (từng từ đều đúng
  // chính tả, chỉ là ghép sai cụm — từ điển từng từ không thể phát hiện được).
  if(KNOWN_PHRASES.includes(norm)) return null; // khớp đúng 1 cụm đã biết
  let bestPhrase=null, bestDist=Infinity;
  for(const p of KNOWN_PHRASES){
    if(Math.abs(p.length-norm.length) > 3) continue;
    const d = levenshtein(norm, p);
    if(d < bestDist){ bestDist=d; bestPhrase=p; if(bestDist===1) break; }
  }
  const phraseThreshold = Math.max(1, Math.floor(norm.length/6));
  if(bestPhrase && bestDist>0 && bestDist<=phraseThreshold){
    return { suggestion: bestPhrase };
  }

  // Không khớp/gần khớp cụm quen thuộc nào -> kiểm tra từng từ riêng lẻ,
  // bỏ qua từ nối (STOP_WORDS) vì từ điển hay không có định nghĩa cho chúng.
  const flaggedIdx = [];
  for(let i=0;i<tokens.length;i++){
    const clean = tokens[i].replace(/[^a-zA-Z']/g,'');
    if(clean.length < 3 || STOP_WORDS.has(clean)) continue;
    const known = await isKnownWord(clean);
    if(!known) flaggedIdx.push(i);
  }
  if(!flaggedIdx.length) return null; // các từ đều hợp lệ — có thể là 1 cụm danh từ/khác ngoài kho, vẫn chấp nhận
  const correctedTokens = [...tokens];
  let hasSuggestion = false;
  flaggedIdx.forEach(i=>{
    const s = findClosestWord(tokens[i].replace(/[^a-zA-Z']/g,''));
    if(s){ correctedTokens[i] = s; hasSuggestion = true; }
  });
  return { suggestion: hasSuggestion ? correctedTokens.join(' ') : null };
}

// ── Kiểm tra chính tả toàn bộ danh sách từ riêng đã có ──────────────
export async function checkMyWordsSpelling(){
  const msgEl = document.getElementById('mw-msg');
  const resultsEl = document.getElementById('mw-spellcheck-results');
  const btn = document.getElementById('mw-check-btn');
  if(!resultsEl) return;
  if(!myWords.length){
    if(msgEl){ msgEl.style.color='var(--yellow)'; msgEl.textContent='Chưa có từ nào để kiểm tra.'; }
    resultsEl.innerHTML='';
    return;
  }
  if(btn){ btn.disabled = true; btn.textContent = '🔍 Đang kiểm tra...'; }
  resultsEl.innerHTML = `<div style="text-align:center;padding:12px;color:var(--muted);font-size:13px;">Đang đối chiếu từ điển cho ${myWords.length} từ, vui lòng đợi chút...</div>`;

  const flagged = [];
  const CONCURRENCY = 4;
  let cursor = 0;
  async function worker(){
    while(cursor < myWords.length){
      const w = myWords[cursor++];
      const check = await checkPhraseSpelling(w.en);
      if(check) flagged.push({id:w.id, en:w.en, suggestion:check.suggestion});
    }
  }
  await Promise.all(Array.from({length:Math.min(CONCURRENCY,myWords.length)}, worker));

  if(btn){ btn.disabled = false; btn.textContent = '🔍 Kiểm tra từ riêng'; }

  if(!flagged.length){
    resultsEl.innerHTML = `<div style="padding:12px;background:var(--green-bg);border:1px solid var(--green);border-radius:10px;color:var(--green);font-size:13px;text-align:center;">✓ Không phát hiện lỗi chính tả nào trong ${myWords.length} từ.</div>`;
    setTimeout(()=>{ if(resultsEl.innerHTML.includes('Không phát hiện')) resultsEl.innerHTML=''; }, 5000);
    return;
  }
  resultsEl.innerHTML = `
    <div style="font-size:12px;color:var(--yellow);margin-bottom:8px;">⚠️ Phát hiện ${flagged.length} từ có thể sai chính tả (đã đối chiếu từ điển tiếng Anh thật):</div>
    ${flagged.map(f=>`
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface);border:1px solid var(--yellow);border-radius:10px;margin-bottom:6px;flex-wrap:wrap;">
        <div style="flex:1;min-width:160px;font-size:13px;font-family:'Space Grotesk',sans-serif;">
          <span style="color:var(--red);text-decoration:line-through;">${f.en}</span>
          ${f.suggestion ? `
            <span style="color:var(--muted);"> → </span>
            <span style="color:var(--green);font-weight:600;">${f.suggestion}</span>
          ` : `
            <span style="color:var(--muted);"> → không tìm thấy trong từ điển</span>
          `}
        </div>
        ${f.suggestion
          ? `<button onclick="fixMyWordSpelling('${f.id}','${f.suggestion}')" style="font-size:12px;padding:6px 10px;background:var(--accent);color:white;border:none;border-radius:8px;cursor:pointer;white-space:nowrap;">Sửa</button>`
          : `
            <div style="display:flex;gap:6px;align-items:center;">
              <input id="fix-input-${f.id}" value="${f.en.replace(/"/g,'&quot;')}" onkeydown="if(event.key==='Enter')fixMyWordManual('${f.id}')" style="font-size:12px;padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);width:130px;font-family:'Space Grotesk',sans-serif;">
              <button onclick="fixMyWordManual('${f.id}')" style="font-size:12px;padding:6px 10px;background:var(--accent);color:white;border:none;border-radius:8px;cursor:pointer;white-space:nowrap;">Lưu</button>
            </div>
          `}
      </div>
    `).join('')}
  `;
}
window.checkMyWordsSpelling = checkMyWordsSpelling;

export async function fixMyWordSpelling(id, correctSpelling){
  const w = myWords.find(x=>x.id===id);
  if(!w) return;
  w.en = correctSpelling;
  await saveMyWords();
  renderMyWords();
  checkMyWordsSpelling(); // chạy lại để cập nhật danh sách còn lỗi
}
window.fixMyWordSpelling = fixMyWordSpelling;

export async function fixMyWordManual(id){
  const input = document.getElementById('fix-input-'+id);
  if(!input) return;
  const newEn = input.value.trim();
  if(!newEn) return;
  const w = myWords.find(x=>x.id===id);
  if(!w) return;
  if(myWords.some(x=>x.id!==id && x.en.toLowerCase()===newEn.toLowerCase())){
    input.style.borderColor='var(--red)';
    input.title='Từ này đã có trong danh sách rồi';
    return;
  }
  w.en = newEn;
  await saveMyWords();
  renderMyWords();
  checkMyWordsSpelling(); // chạy lại để cập nhật danh sách còn lỗi
}
window.fixMyWordManual = fixMyWordManual;

export async function addMyWord(){
  const en = document.getElementById('mw-en').value.trim();
  const vn = document.getElementById('mw-vn').value.trim();
  const ex = document.getElementById('mw-ex').value.trim();
  const msgEl = document.getElementById('mw-msg');
  const addBtn = document.getElementById('mw-add-btn');

  if(!en || !vn){ msgEl.style.color='var(--red)'; msgEl.textContent='Vui lòng nhập đủ từ và nghĩa.'; return; }

  // Check duplicate
  if(myWords.some(w=>w.en.toLowerCase()===en.toLowerCase())){
    msgEl.style.color='var(--yellow)'; msgEl.textContent='Từ này đã có trong danh sách.'; return;
  }

  if(addBtn) addBtn.disabled = true;
  msgEl.style.color='var(--muted)'; msgEl.textContent='Đang kiểm tra chính tả...';
  const check = await checkPhraseSpelling(en);
  if(addBtn) addBtn.disabled = false;
  msgEl.textContent = '';

  if(check && check.suggestion){
    showConfirm(
      'Kiểm tra chính tả',
      `Bạn nhập "${en}" — có phải ý bạn là "${check.suggestion}" không?`,
      ()=>{ document.getElementById('mw-en').value = check.suggestion; _insertMyWord(check.suggestion, vn, ex); },
      ()=>{ _insertMyWord(en, vn, ex); }
    );
    return;
  }
  await _insertMyWord(en, vn, ex);
}
window.addMyWord = addMyWord;

async function _insertMyWord(en, vn, ex){
  const msgEl = document.getElementById('mw-msg');
  const newWord = { en, vn, ex, id: Date.now().toString() };
  myWords.push(newWord);
  await saveMyWords();

  document.getElementById('mw-en').value='';
  document.getElementById('mw-vn').value='';
  document.getElementById('mw-ex').value='';
  msgEl.style.color='var(--green)';
  msgEl.textContent='✓ Đã thêm "'+en+'"!';
  setTimeout(()=>{ msgEl.textContent=''; }, 2000);

  renderMyWords();
  updateMyWordChip();
  buildTopicChips(); // refresh chips to update count
  // Add card directly to deck if mix is checked (works even when on other tab)
  const mixCheck2 = document.getElementById('mw-mix');
  if(mixCheck2 && mixCheck2.checked && deck.length > 0){
    const newCard = {topic:'Từ riêng',en:newWord.en,pos:'',en_alt:[],vn:newWord.vn,vn_alt:[],ex:newWord.ex||''};
    // Insert at random position
    const insertAt = Math.floor(Math.random()*(deck.length-idx)) + idx + 1;
    deck.splice(insertAt, 0, newCard);
    updateProgressDisplay();
  }
}

export async function deleteMyWord(id){
  const toDelete = myWords.find(w=>w.id===id);
  if(!toDelete) return;
  showConfirm('Xóa từ', `Xóa từ "${toDelete.en}" khỏi danh sách từ riêng?`, async ()=>{
    const deletedEn = toDelete.en || '';
    myWords = myWords.filter(w=>w.id!==id);
    // Also remove from bookmarks if bookmarked
    if(bookmarks.has(deletedEn)){
      bookmarks.delete(deletedEn);
      const lsKeyBm = 'toeic_bm_'+currentUser.username;
      localStorage.setItem(lsKeyBm, JSON.stringify([...bookmarks]));
      updateDoc(doc(db,'users',currentUser.username),{bookmarks:[...bookmarks]}).catch(()=>{});
      updateBookmarkChip();
    }
    await saveMyWords();
    renderMyWords();
    updateMyWordChip();
    // Remove card directly from deck if present (works even when on other tab)
    const mixCheck3 = document.getElementById('mw-mix');
    if(mixCheck3 && mixCheck3.checked && deck.length > 0){
      const beforeLen = deck.length;
      deck = deck.filter(d => !(d.topic==='Từ riêng' && d.en===deletedEn));
      if(deck.length < beforeLen){
        if(idx >= deck.length) idx = Math.max(0, deck.length-1);
        updateProgressDisplay();
      }
    }
  });
}
window.deleteMyWord = deleteMyWord;

export function renderMyWords(){
  const listEl  = document.getElementById('mw-list');
  const countEl = document.getElementById('mw-count');
  if(!listEl) return;
  if(countEl) countEl.textContent = 'Từ đã thêm ('+(myWords.length)+')';

  if(!myWords.length){
    listEl.innerHTML='<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px;">Chưa có từ nào. Thêm từ mới ở trên!</div>';
    return;
  }
  listEl.innerHTML = myWords.map(w=>`
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;">
      <div style="flex:1;">
        <div style="font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:14px;">${w.en}
          <button data-word="${w.en}" onclick="dictSpeak(this.dataset.word)" style="background:none;border:none;cursor:pointer;font-size:14px;margin-left:4px;">🔊</button>
        </div>
        <div style="font-size:12px;color:var(--green);margin-top:2px;">${w.vn}</div>
        ${w.ex?'<div style="font-size:11px;color:var(--muted);font-style:italic;margin-top:2px;">'+w.ex+'</div>':''}
      </div>
      <button onclick="deleteMyWord('${w.id}')" style="background:transparent;border:none;color:var(--red);cursor:pointer;font-size:18px;padding:4px;">🗑</button>
    </div>`).join('');
}

// ── Xuất / Nhập từ riêng (chia sẻ giữa các học viên) ────────────────
export function exportMyWords(){
  const msgEl = document.getElementById('mw-msg');
  if(!myWords.length){
    if(msgEl){ msgEl.style.color='var(--yellow)'; msgEl.textContent='Chưa có từ nào để xuất.'; }
    return;
  }
  const payload = {
    app: 'TOEIC KING', type: 'my-words', exportedBy: currentUser?.displayName || '',
    words: myWords.map(w=>({en:w.en, vn:w.vn, ex:w.ex||''}))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = (currentUser?.username || 'tu-rieng').replace(/[^a-z0-9_-]/gi,'');
  a.href = url;
  a.download = `toeicking-tu-rieng-${safeName}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
window.exportMyWords = exportMyWords;

export function importMyWords(file){
  const msgEl = document.getElementById('mw-msg');
  const fileInput = document.getElementById('mw-import-file');
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async (e)=>{
    if(fileInput) fileInput.value = ''; // cho phép chọn lại cùng file lần sau
    let data;
    try{ data = JSON.parse(e.target.result); }
    catch(err){
      if(msgEl){ msgEl.style.color='var(--red)'; msgEl.textContent='File không hợp lệ (không đọc được JSON).'; }
      return;
    }
    const list = Array.isArray(data) ? data : Array.isArray(data?.words) ? data.words : null;
    if(!list){
      if(msgEl){ msgEl.style.color='var(--red)'; msgEl.textContent='File không đúng định dạng từ riêng.'; }
      return;
    }
    const existing = new Set(myWords.map(w=>w.en.toLowerCase()));
    let added = 0, skipped = 0;
    list.forEach(item=>{
      const en = String(item?.en||'').trim();
      const vn = String(item?.vn||'').trim();
      const ex = String(item?.ex||'').trim();
      if(!en || !vn) return;
      if(existing.has(en.toLowerCase())){ skipped++; return; }
      existing.add(en.toLowerCase());
      myWords.push({en, vn, ex, id: Date.now().toString()+Math.random().toString(36).slice(2,6)});
      added++;
    });
    if(added>0) await saveMyWords();
    renderMyWords();
    updateMyWordChip();
    buildTopicChips();
    if(msgEl){
      msgEl.style.color='var(--green)';
      msgEl.textContent = `✓ Đã nhập ${added} từ mới${skipped?` (bỏ qua ${skipped} từ trùng)`:''}.`;
      setTimeout(()=>{ msgEl.textContent=''; }, 3000);
    }
  };
  reader.readAsText(file);
}
window.importMyWords = importMyWords;

// Mix my words - called after buildDeck sets up deck
export function mixMyWordsIntoDeck(){
  const mixCheck = document.getElementById('mw-mix');
  if(mixCheck && mixCheck.checked && myWords.length>0 && activeTopic!=='bookmarks' && activeTopic!=='mywords'){
    const extra = myWords.map(w=>({
      topic:'Từ riêng',en:w.en,pos:'',en_alt:[],
      vn:w.vn,vn_alt:[],ex:w.ex||''
    }));
    deck = [...deck, ...extra];
    for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
  }
}
// ── Keyboard & Touch ──────────────────────────────────────────────
// Save session when user closes/refreshes tab
window.addEventListener('beforeunload', ()=>{ saveLastSessionLocal(); });

document.addEventListener('keydown',e=>{
  if(document.getElementById('login-screen').style.display!=='none')return;
  if(e.key==='Enter'){e.preventDefault();if(!answered)checkAnswer();else nextCard();}
  if(e.key==='ArrowRight'&&!document.getElementById('answer-input').matches(':focus'))skipCard();
  if(e.key==='ArrowLeft'&&!document.getElementById('answer-input').matches(':focus'))prevCard();
});
export let touchX=0;
document.getElementById('flashcard')?.addEventListener('touchstart',e=>{touchX=e.touches[0].clientX;},{passive:true});
document.getElementById('flashcard')?.addEventListener('touchend',e=>{
  const dx=e.changedTouches[0].clientX-touchX;
  if(Math.abs(dx)>60){dx<0?skipCard():prevCard();}
},{passive:true});


// ── Cross-module state setters (used by auth.js / app.js) ─────────
export function setHistory(arr){ history = arr; }
export function markSessionSaved(){ savedCorrect = correctCount; savedWrong = wrongCount; }
