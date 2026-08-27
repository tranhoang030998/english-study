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
  stopDictationAudio();
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

export function stopDictationAudio(){
  if(window.speechSynthesis) window.speechSynthesis.cancel();
  _dictPlaying = false;
  clearInterval(_dictProgressTimer);
  updatePlayIcon(false);
  const bar = document.getElementById('dict-progress-fill');
  if(bar) bar.style.width = '0%';
}
window.stopDictationAudio = stopDictationAudio;

// ── Phát âm thanh: chia câu dài thành từng cụm ngắn, đọc nối tiếp nhau ──────
// (câu ngắn ít khi bị lỗi cắt cụt hơn hẳn so với đọc nguyên câu dài 1 lần —
// đây là hướng khắc phục mạnh hơn 2 lần vá trước, vốn chỉ chỉnh thời điểm
// gọi cancel()/speak() mà chưa giải quyết được gốc rễ).
let _voicesReady = false;
if(window.speechSynthesis){
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener('voiceschanged', ()=>{ _voicesReady = true; });
}

let _dictUtterQueue = [];   // các SpeechSynthesisUtterance đang giữ tham chiếu sống
let _dictPlaying = false;
let _dictProgressTimer = null;
let _dictProgressStart = 0;
let _dictProgressTotalMs = 0;

function splitIntoChunks(sentence){
  // Cắt theo dấu phẩy/chấm phẩy trước, cụm nào vẫn còn dài (>5 từ) thì cắt tiếp theo nhóm 4 từ
  const clauses = sentence.split(/(?<=[,;])\s+/);
  const chunks = [];
  clauses.forEach(clause=>{
    const words = clause.trim().split(/\s+/);
    if(words.length <= 5){ chunks.push(clause.trim()); return; }
    for(let i=0;i<words.length;i+=4){
      chunks.push(words.slice(i,i+4).join(' '));
    }
  });
  return chunks.filter(Boolean);
}

function updatePlayIcon(playing){
  const btn = document.getElementById('dict-play-btn');
  if(btn) btn.textContent = playing ? '⏸' : '▶️';
}

function startProgressBar(totalMs){
  const bar = document.getElementById('dict-progress-fill');
  if(!bar) return;
  _dictProgressStart = Date.now();
  _dictProgressTotalMs = totalMs;
  clearInterval(_dictProgressTimer);
  _dictProgressTimer = setInterval(()=>{
    const elapsed = Date.now() - _dictProgressStart;
    const pct = Math.min(100, (elapsed/_dictProgressTotalMs)*100);
    bar.style.width = pct+'%';
    if(pct>=100) clearInterval(_dictProgressTimer);
  }, 100);
}
function stopProgressBar(fill){
  clearInterval(_dictProgressTimer);
  const bar = document.getElementById('dict-progress-fill');
  if(bar) bar.style.width = fill ? '100%' : '0%';
}

function speakChunks(chunks, i){
  if(i >= chunks.length){
    _dictPlaying = false;
    updatePlayIcon(false);
    stopProgressBar(true);
    return;
  }
  const utter = new SpeechSynthesisUtterance(chunks[i]);
  utter.lang = 'en-US';
  utter.rate = 0.85;
  utter.onend = ()=>{ if(_dictPlaying) speakChunks(chunks, i+1); };
  utter.onerror = ()=>{ if(_dictPlaying) speakChunks(chunks, i+1); }; // lỗi 1 cụm thì bỏ qua, đọc tiếp cụm sau
  _dictUtterQueue.push(utter); // giữ tham chiếu sống, tránh bị dọn rác giữa chừng
  window.speechSynthesis.speak(utter);
}

export function playDictationAudio(){
  if(!window.speechSynthesis) return;
  const item = dictDeck[dictIdx];
  if(!item) return;

  if(_dictPlaying){
    // Đang đọc -> bấm là Tạm dừng
    window.speechSynthesis.pause();
    _dictPlaying = false;
    updatePlayIcon(false);
    clearInterval(_dictProgressTimer);
    return;
  }
  if(window.speechSynthesis.paused){
    // Đang tạm dừng -> bấm là Đọc tiếp
    window.speechSynthesis.resume();
    _dictPlaying = true;
    updatePlayIcon(true);
    return;
  }

  // Bắt đầu đọc mới từ đầu
  window.speechSynthesis.cancel();
  _dictUtterQueue = [];
  const chunks = splitIntoChunks(item.sentence);
  const wordCount = item.sentence.split(/\s+/).length;
  const estMs = Math.max(1200, wordCount * 420); // ước lượng ~420ms/từ ở rate 0.85
  _dictPlaying = true;
  updatePlayIcon(true);
  startProgressBar(estMs);
  speakChunks(chunks, 0);
}
window.playDictationAudio = playDictationAudio;

export function checkDictation(){
  if(dictChecked) return;
  stopDictationAudio();
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
