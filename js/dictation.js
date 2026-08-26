import { ALL_WORDS } from './data/words.js';
import { myWords } from './flashcard.js';
import { DICTATION_SENTENCES } from './data/dictation-sentences.js';

// ── Xây kho câu ví dụ để luyện nghe-chép (chỉ lấy câu đủ dài, có nghĩa) ────
let _dictationPool = null;
function getDictationPool(){
  if(_dictationPool) return _dictationPool;
  const pool = [];
  ALL_WORDS.forEach(w=>{
    if(w.ex && w.ex.trim().length >= 12){
      pool.push({ sentence: w.ex.trim(), topic: w.topic || 'TOEIC', word: w.en });
    }
  });
  _dictationPool = pool;
  return pool;
}

let dictDeck = [];
let dictIdx = 0;
let dictDone = 0;
let dictScoreSum = 0;
let dictChecked = false;

function buildDictDeck(){
  const base = [...getDictationPool(), ...DICTATION_SENTENCES];
  // Trộn thêm câu ví dụ học viên tự thêm (nếu có)
  myWords.forEach(w=>{
    if(w.ex && w.ex.trim().length >= 12){
      base.push({ sentence: w.ex.trim(), topic: 'Từ riêng', word: w.en });
    }
  });
  // Xáo trộn ngẫu nhiên
  for(let i=base.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  dictDeck = base.slice(0, 30); // 1 phiên 30 câu, đủ dùng và không quá tải
}

function tokenize(sentence){
  return sentence.trim().split(/\s+/).filter(Boolean);
}
function normWord(w){
  return w.toLowerCase().replace(/[^a-z0-9']/g,'');
}

// So khớp theo từ (thuật toán LCS) — chịu được thiếu/thừa từ, không lệch dây chuyền
// như so vị trí đơn thuần.
function wordDiff(targetWords, saidWords){
  const m = targetWords.length, n = saidWords.length;
  const dp = Array.from({length:m+1}, ()=>new Array(n+1).fill(0));
  for(let i=1;i<=m;i++){
    for(let j=1;j<=n;j++){
      if(normWord(targetWords[i-1])===normWord(saidWords[j-1])) dp[i][j]=dp[i-1][j-1]+1;
      else dp[i][j]=Math.max(dp[i-1][j],dp[i][j-1]);
    }
  }
  let i=m, j=n;
  const result = [];
  while(i>0 && j>0){
    if(normWord(targetWords[i-1])===normWord(saidWords[j-1])){
      result.unshift({type:'match', word:targetWords[i-1]});
      i--; j--;
    } else if(dp[i-1][j] >= dp[i][j-1]){
      result.unshift({type:'miss', word:targetWords[i-1]});
      i--;
    } else {
      result.unshift({type:'extra', word:saidWords[j-1]});
      j--;
    }
  }
  while(i>0){ result.unshift({type:'miss', word:targetWords[i-1]}); i--; }
  while(j>0){ result.unshift({type:'extra', word:saidWords[j-1]}); j--; }
  return result;
}

export function initDictation(){
  if(!dictDeck.length) buildDictDeck();
  dictIdx = 0; dictDone = 0; dictScoreSum = 0;
  renderDictationCard();
  updateDictSessionStats();
}

function renderDictationCard(){
  if(dictIdx >= dictDeck.length) buildDictDeck(), dictIdx = 0; // hết bộ thì trộn lại bộ mới
  const item = dictDeck[dictIdx];
  document.getElementById('dict-progress').textContent = `Câu ${dictIdx+1}`;
  document.getElementById('dict-topic').textContent = item.topic;
  document.getElementById('dict-input').value = '';
  document.getElementById('dict-input').disabled = false;
  document.getElementById('dict-result').style.display = 'none';
  document.getElementById('dict-check-btn').style.display = '';
  document.getElementById('dict-next-btn').style.display = 'none';
  dictChecked = false;
}

let _dictUtterance = null; // giữ tham chiếu sống, tránh bị trình duyệt "dọn rác" giữa chừng khi câu dài
export function playDictationAudio(){
  if(!window.speechSynthesis) return;
  const item = dictDeck[dictIdx];
  if(!item) return;
  window.speechSynthesis.cancel();
  // Đợi 1 nhịp ngắn sau cancel() trước khi speak() — tránh xung đột khiến
  // câu bị cắt cụt chỉ còn nghe được vài chữ cuối (bug hay gặp trên Chrome Android).
  setTimeout(()=>{
    const utter = new SpeechSynthesisUtterance(item.sentence);
    utter.lang = 'en-US';
    utter.rate = 0.85;
    _dictUtterance = utter;
    window.speechSynthesis.speak(utter);
  }, 80);
}
window.playDictationAudio = playDictationAudio;

export function checkDictation(){
  if(dictChecked) return;
  const item = dictDeck[dictIdx];
  if(!item) return;
  const said = document.getElementById('dict-input').value.trim();
  const targetWords = tokenize(item.sentence);
  const saidWords = tokenize(said);
  const diff = wordDiff(targetWords, saidWords);
  const matchCount = diff.filter(d=>d.type==='match').length;
  const pct = targetWords.length ? Math.round((matchCount/targetWords.length)*100) : 0;

  let color, label;
  if(pct>=90){ color='var(--green)'; label='🎉 Xuất sắc!'; }
  else if(pct>=70){ color='var(--green)'; label='✓ Khá tốt'; }
  else if(pct>=40){ color='var(--yellow)'; label='~ Cần luyện thêm'; }
  else{ color='var(--red)'; label='✗ Nghe lại và thử lại nhé'; }

  const diffHtml = diff.map(d=>{
    if(d.type==='match') return `<span style="color:var(--green);">${d.word}</span>`;
    if(d.type==='miss')  return `<span style="color:var(--red);text-decoration:line-through;opacity:.8;">${d.word}</span>`;
    return `<span style="color:var(--yellow);">${d.word}</span><sub style="color:var(--muted);font-size:9px;"> (thừa)</sub>`;
  }).join(' ');

  const resultEl = document.getElementById('dict-result');
  resultEl.style.display = 'block';
  resultEl.innerHTML = `
    <div style="font-size:18px;font-weight:700;color:${color};margin-bottom:8px;">${pct}% — ${label}</div>
    <div style="margin-bottom:10px;">${diffHtml}</div>
    <div style="font-size:12px;color:var(--muted);border-top:1px solid var(--border);padding-top:8px;">Câu đúng: <span style="color:var(--text);">${item.sentence}</span></div>
  `;

  document.getElementById('dict-input').disabled = true;
  document.getElementById('dict-check-btn').style.display = 'none';
  document.getElementById('dict-next-btn').style.display = '';
  dictChecked = true;

  dictDone++;
  dictScoreSum += pct;
  updateDictSessionStats();
}
window.checkDictation = checkDictation;

export function nextDictationSentence(){
  dictIdx++;
  renderDictationCard();
}
window.nextDictationSentence = nextDictationSentence;

function updateDictSessionStats(){
  const el = document.getElementById('dict-session-stats');
  if(!el) return;
  const avg = dictDone>0 ? Math.round(dictScoreSum/dictDone) : null;
  el.textContent = `Đã làm: ${dictDone} · Điểm TB: ${avg===null?'—':avg+'%'}`;
}
