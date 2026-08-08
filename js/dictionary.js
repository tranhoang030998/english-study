import { ALL_WORDS } from './data/words.js';
import { COMMON_WORDS, DICT_API, QUICK_WORDS } from './data/dictionary-data.js';

export let dictAudio = null;
export let dictInitDone = false;

// Quick words from TOEIC vocab - pick 20 representative ones
export function initDictionary(){
  if(dictInitDone) return;
  dictInitDone = true;
  const wrap = document.getElementById('dict-quick-words');
  if(!wrap) return;
  QUICK_WORDS.forEach(w => {
    const btn = document.createElement('button');
    btn.className = 'topic-chip';
    btn.textContent = w;
    btn.onclick = () => { document.getElementById('dict-input').value=w; lookupWord(); };
    wrap.appendChild(btn);
  });
}
window.initDictionary = initDictionary;

export async function lookupWord(){
  const word = document.getElementById('dict-input').value.trim().toLowerCase();
  if(!word) return;

  const resultEl = document.getElementById('dict-result');
  resultEl.innerHTML = '<div class="dict-loading">Đang tra từ "'+word+'"...</div>';

  try{
    const res = await fetch(DICT_API + encodeURIComponent(word));
    if(!res.ok){
      // Fallback to built-in TOEIC vocabulary
      showBuiltinEntry(word, resultEl);
      return;
    }
    const data = await res.json();
    renderDictResult(data[0]);
  }catch(e){
    // Fallback to built-in TOEIC vocabulary
    showBuiltinEntry(word, resultEl);
  }
}
window.lookupWord = lookupWord;

export function showBuiltinEntry(word, resultEl){
  // Look up word in ALL_WORDS
  const found = ALL_WORDS.find(w =>
    w.en.toLowerCase() === word ||
    w.en.toLowerCase().replace(/\s*\([^)]+\)/g,'').trim() === word
  );

  // Also check COMMON_WORDS
  if(!found){
    const base2 = word.replace(/(ing|ed|s|es|er|est|ly)$/, '');
    const cw = COMMON_WORDS.find(w => w.w === word || w.w === base2);
    if(cw){
      const allVns = [cw.v,...(cw.a||[])].filter(Boolean);
      let h = '<div class="dict-word-header">';
      h += '<div style="display:flex;align-items:center;gap:10px;">';
      h += '<div class="dict-word-title">'+word+'</div>';
      h += '<button class="dict-audio-btn" data-word="'+word+'" onclick="dictSpeak(this.dataset.word)">🔊 Nghe</button>';
      h += '</div>';
      if(cw.p) h += '<div class="dict-phonetic"><span style="color:var(--accent);font-weight:600">'+cw.p+'</span></div>';
      h += '</div>';
      h += '<div class="dict-meaning-block"><div class="dict-pos">Common English</div>';
      allVns.forEach((m,i)=>{
        h += '<div class="dict-def-item"><div class="dict-def-num">'+(i+1)+'</div>';
        h += '<div class="dict-def-text" style="color:var(--green)">'+m+'</div></div>';
      });
      h += '</div>';
      resultEl.innerHTML = h;
      return;
    }
    resultEl.innerHTML = '<div class="dict-not-found">Không tìm thấy "<b>'+word+'</b>" trong từ điển.<br>Thử kiểm tra chính tả hoặc tìm từ gốc.</div>';
    return;
  }

  const allMeanings = [found.vn, ...(found.vn_alt||[])].filter(Boolean);
  let html = '<div class="dict-word-header">';
  html += '<div style="display:flex;align-items:center;gap:10px;">';
  html += '<div class="dict-word-title">'+found.en+'</div>';
  html += '<button class="dict-audio-btn" data-word="'+found.en+'" onclick="dictSpeak(this.dataset.word)" style="flex-shrink:0">🔊 Nghe</button>';
  html += '</div>';
  if(found.pos) html += '<div class="dict-phonetic"><span style="color:var(--accent);font-weight:600">'+found.pos+'</span></div>';
  html += '</div>';
  html += '<div class="dict-meaning-block">';
  html += '<div class="dict-pos">TOEIC Vocabulary</div>';
  allMeanings.forEach((m,i)=>{
    html += '<div class="dict-def-item">';
    html += '<div class="dict-def-num">'+(i+1)+'</div>';
    html += '<div class="dict-def-text" style="color:var(--green)">'+m+'</div>';
    html += '</div>';
  });
  if(found.ex){
    html += '<div style="margin-top:10px;padding:8px 12px;background:var(--surface2);border-radius:8px;font-size:13px;color:var(--muted);font-style:italic;">"'+found.ex+'"</div>';
  }
  if(found.en_alt&&found.en_alt.length){
    html += '<div class="dict-synonyms" style="margin-top:8px;">Synonyms: ';
    found.en_alt.forEach(s=>{ html += '<span class="dict-syn-chip" data-word="'+s+'" onclick="dictSynClick(this)">'+s+'</span>'; });
    html += '</div>';
  }
  html += '</div>';
  html += '<div style="font-size:11px;color:var(--muted);margin-top:8px;">📚 Nguồn: TOEIC Vocabulary (600 từ)</div>';
  resultEl.innerHTML = html;
}

export function renderDictResult(entry){
  if(!entry){ document.getElementById('dict-result').innerHTML='<div class="dict-not-found">Không có kết quả.</div>'; return; }

  const audioUrl = entry.phonetics?.find(p=>p.audio)?.audio || '';
  const phonetic = entry.phonetic || entry.phonetics?.find(p=>p.text)?.text || '';

  // Also look up Vietnamese meanings from TOEIC vocab
  const vnEntry = ALL_WORDS.find(w =>
    w.en.toLowerCase().replace(/\s*\([^)]+\)/g,'').trim() === (entry.word||'').toLowerCase()
  );

  let html = '<div class="dict-word-header">';
  html += '<div style="display:flex;align-items:center;gap:10px;">';
  html += '<div class="dict-word-title">'+entry.word+'</div>';
  html += '<button class="dict-audio-btn" data-word="'+entry.word+'" onclick="dictSpeak(this.dataset.word)" style="flex-shrink:0">🔊 Nghe</button>';
  html += '</div>';
  html += '<div class="dict-phonetic">';
  if(phonetic) html += '<span>'+phonetic+'</span>';

  html += '</div>';

  // Show Vietnamese meanings if found in TOEIC vocab
  if(vnEntry){
    const allVn = [vnEntry.vn, ...(vnEntry.vn_alt||[])].filter(Boolean);
    html += '<div style="margin-top:8px;padding:8px 12px;background:rgba(79,124,255,.08);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;">';
    html += '<div style="font-size:10px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Nghĩa tiếng Việt</div>';
    allVn.forEach((v,i)=>{
      html += '<div style="font-size:13px;color:var(--green);margin-bottom:2px;">'+(i+1)+'. '+v+'</div>';
    });
    html += '</div>';
  }
  html += '</div>';

  (entry.meanings||[]).forEach(m => {
    html += '<div class="dict-meaning-block">';
    html += '<div class="dict-pos">'+m.partOfSpeech+'</div>';
    (m.definitions||[]).slice(0,3).forEach((d,i) => {
      html += '<div class="dict-def-item">';
      html += '<div class="dict-def-num">'+(i+1)+'</div>';
      html += '<div class="dict-def-text">'+d.definition+'</div>';
      if(d.example) html += '<div class="dict-example">"'+d.example+'"</div>';
      html += '</div>';
    });
    const syns = (m.synonyms||[]).slice(0,6);
    if(syns.length){
      html += '<div class="dict-synonyms">Từ đồng nghĩa: ';
      syns.forEach(s=>{ html += '<span class="dict-syn-chip" data-word="'+s+'" onclick="dictSynClick(this)">'+s+'</span>'; });
      html += '</div>';
    }
    html += '</div>';
  });

  document.getElementById('dict-result').innerHTML = html;
}

export function dictSpeak(word){
  if(!window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(word);
  utter.lang = 'en-US'; utter.rate = 0.85;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}
window.dictSpeak = dictSpeak;

export function dictSynClick(el){
  document.getElementById('dict-input').value = el.dataset.word;
  lookupWord();
}
window.dictSynClick = dictSynClick;

export function playDictAudio(url){
  if(dictAudio) dictAudio.pause();
  dictAudio = new Audio(url);
  dictAudio.play().catch(()=>{});
}
window.playDictAudio = playDictAudio;

// ── BOOKMARK SYSTEM ───────────────────────────────────────────────
