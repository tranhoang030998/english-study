import { db } from './firebase-config.js';
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { currentUser } from './auth.js';
import { showConfirm } from './utils.js';

const INITIAL_ROWS = 15;

function rowsContainer(){ return document.getElementById('vt-rows'); }

function renderRow(n){
  return `<div style="display:flex;align-items:center;gap:8px;">
    <div style="width:26px;text-align:center;color:var(--muted);font-family:'Space Grotesk',sans-serif;font-size:13px;flex-shrink:0;">${n}</div>
    <input class="vt-row-input" placeholder="Từ tiếng Anh..." style="flex:1;min-width:0;padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'Space Grotesk',sans-serif;font-size:14px;">
  </div>`;
}

export function initVocabTest(){
  const el = rowsContainer();
  if(!el) return;
  let html = '';
  for(let i=1;i<=INITIAL_ROWS;i++) html += renderRow(i);
  el.innerHTML = html;
  const msgEl = document.getElementById('vt-msg');
  if(msgEl) msgEl.textContent = '';
}

export function addVocabTestRow(){
  const el = rowsContainer();
  if(!el) return;
  const count = el.querySelectorAll('.vt-row-input').length;
  el.insertAdjacentHTML('beforeend', renderRow(count+1));
}
window.addVocabTestRow = addVocabTestRow;

// Dùng để cảnh báo khi rời tab mà chưa nộp bài (chống gian lận: rời ra tra từ
// điển/dịch rồi quay lại ghi tiếp).
export function hasUnsavedVocabTest(){
  const el = rowsContainer();
  if(!el) return false;
  return Array.from(el.querySelectorAll('.vt-row-input')).some(inp=>inp.value.trim().length>0);
}
window.hasUnsavedVocabTest = hasUnsavedVocabTest;

export function clearVocabTest(){
  initVocabTest();
}
window.clearVocabTest = clearVocabTest;

export async function submitVocabTest(){
  const msgEl = document.getElementById('vt-msg');
  if(!currentUser){
    if(msgEl){ msgEl.style.color='var(--red)'; msgEl.textContent='Bạn cần đăng nhập trước.'; }
    return;
  }
  const el = rowsContainer();
  const words = Array.from(el.querySelectorAll('.vt-row-input'))
    .map(inp=>inp.value.trim())
    .filter(Boolean);
  if(!words.length){
    if(msgEl){ msgEl.style.color='var(--yellow)'; msgEl.textContent='Bạn chưa ghi từ nào cả.'; }
    return;
  }
  showConfirm('Nộp bài?', `Bạn có chắc muốn nộp ${words.length} từ đã ghi không? Sau khi nộp sẽ không sửa được nữa.`, async ()=>{
    const submitBtn = document.getElementById('vt-submit-btn');
    if(submitBtn) submitBtn.disabled = true; // chặn bấm nộp nhiều lần khi máy lag
    try{
      await addDoc(collection(db,'vocab_tests'), {
        username: currentUser.username,
        displayName: currentUser.displayName,
        words,
        submittedAt: serverTimestamp(),
      });
      if(msgEl){ msgEl.style.color='var(--green)'; msgEl.textContent = `✓ Đã gửi ${words.length} từ. Cảm ơn bạn!`; }
      initVocabTest(); // reset form sau khi nộp thành công
    }catch(e){
      if(msgEl){ msgEl.style.color='var(--red)'; msgEl.textContent = 'Lỗi khi gửi bài: '+e.message; }
    } finally {
      if(submitBtn) submitBtn.disabled = false;
    }
  });
}
window.submitVocabTest = submitVocabTest;
