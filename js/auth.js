import { db } from './firebase-config.js';
import { doc, getDoc, updateDoc, increment, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getVNDate } from './utils.js';
import { buildTopicChips, restart, loadBookmarks, loadMyWords, history, setHistory } from './flashcard.js';
import { ALL_PANELS, currentTop, setCurrentTop } from './app.js';

export let currentUser = null; // {username, displayName, isAdmin}

export async function doLogin() {
  const username = document.getElementById('login-username').value.trim().toLowerCase();
  const pin      = document.getElementById('login-pin').value.trim();
  const errEl    = document.getElementById('login-err');
  errEl.textContent = '';
  if (!username || !pin) { errEl.textContent = 'Vui lòng nhập đầy đủ.'; return; }

  try {
    const ref  = doc(db, 'users', username);
    const snap = await getDoc(ref);
    if (!snap.exists()) { errEl.textContent = 'Tài khoản không tồn tại.'; return; }
    const data = snap.data();
    if (data.pin !== pin) { errEl.textContent = 'Mã PIN không đúng.'; return; }

    currentUser = { username, displayName: data.displayName || username, isAdmin: data.isAdmin || false };
    localStorage.setItem('toeic_user', JSON.stringify(currentUser));
    localStorage.setItem('toeic_login_at', Date.now().toString());

    // Update streak
    await updateStreak(username);
    showApp();
    startUpdateListener();
    startHeartbeat();
  } catch(e) {
    errEl.textContent = 'Lỗi kết nối. Thử lại.';
    console.error(e);
  }
}
window.doLogin = doLogin;

export async function updateStreak(username) {
  const ref  = doc(db, 'users', username);
  const snap = await getDoc(ref);
  const data = snap.data();
  const today     = getVNDate(0);   // e.g. "2026-08-07"
  const yesterday = getVNDate(-1);  // e.g. "2026-08-06"
  const lastDay   = data.lastStudyDay || '';

  let streak = data.streak || 0;
  if(lastDay === today){
    // Already counted today — no change
  } else if(lastDay === yesterday){
    streak += 1;  // Consecutive day ✓
  } else if(lastDay > today){
    // lastStudyDay đã lưu trên server "mới hơn" ngày mà THIẾT BỊ NÀY tính ra —
    // gần như chắc chắn đồng hồ thiết bị này đang chạy sai (chậm hơn thực tế).
    // Không reset/ghi đè để tránh làm mất streak đúng đã lưu từ thiết bị khác.
    return streak;
  } else {
    streak = 1;   // Missed a day — reset
  }
  await updateDoc(ref, { streak, lastStudyDay: today });
  return streak;
}

export function doLogout() {
  saveLastSessionLocal(); // Sync save to localStorage before logout
  saveLastSession();       // Async save to Firestore (best effort)
  stopHeartbeat();
  localStorage.removeItem('toeic_user');
  currentUser = null;
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}
window.doLogout = doLogout;

export function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  const appEl = document.getElementById('app');
  appEl.style.display = 'flex';

  document.getElementById('user-name-display').textContent = currentUser.displayName;
  if(currentUser.isAdmin){
    document.getElementById('admin-tab-btn').style.display='';
  }
  // Set initial data-tab on sub-nav buttons
  document.querySelectorAll('#flashcard-subnav .tab-btn').forEach((b,i)=>{
    b.setAttribute('data-tab',['practice','mywords','summary','ranking'][i]);
  });
  loadUserStreak();
  loadBookmarks();
  loadMyWords();
  buildTopicChips();
  // Always start at Flashcard > Luyện tập regardless of previous tab
  document.querySelectorAll('.top-tab').forEach(b=>b.classList.remove('active'));
  document.querySelector('.top-tab').classList.add('active'); // first top tab = Flashcard
  document.querySelectorAll('#flashcard-subnav .tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('#flashcard-subnav .tab-btn').classList.add('active'); // first = Luyện tập
  document.getElementById('flashcard-subnav').style.display='flex';
  ALL_PANELS.forEach(p=>{ const el=document.getElementById(p); if(el) el.style.display='none'; });
  setCurrentTop('flashcard');
  restart();
}

export async function loadUserStreak() {
  const ref  = doc(db, 'users', currentUser.username);
  const snap = await getDoc(ref);
  const streak = snap.data()?.streak || 0;
  document.getElementById('streak-display').textContent = streak > 0 ? `🔥${streak}` : '';
}

// Auto-login
window.addEventListener('load', () => {
  const saved = localStorage.getItem('toeic_user');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      showApp();
      startUpdateListener();
      startHeartbeat();
      // Cập nhật streak ngay cả khi tự động đăng nhập (không gõ lại PIN),
      // để streak không bị đứng yên rồi "rớt" oan vào lần gõ PIN kế tiếp
      updateStreak(currentUser.username).then(()=>loadUserStreak());
      // Re-verify in background
      getDoc(doc(db,'users',currentUser.username)).then(snap=>{
        if(!snap.exists()){doLogout();}
      });
    } catch(e){ doLogout(); }
  }

  // Login on Enter
  document.getElementById('login-pin').addEventListener('keydown', e => {
    if(e.key==='Enter') doLogin();
  });
});

// ── Tab switching ─────────────────────────────────────────────────

// ── TOP LEVEL TAB SWITCH ──────────────────────────────────────────
export let updateListener = null;

export function startUpdateListener(){
  if(updateListener) updateListener(); // unsubscribe previous
  const configRef = doc(db, 'config', 'app');
  updateListener = onSnapshot(configRef, (snap) => {
    if(!snap.exists() || !currentUser) return;
    const forceAt = snap.data()?.forceLogoutAt?.toMillis?.() || 0;
    const loginAt = parseInt(localStorage.getItem('toeic_login_at') || '0');
    if(forceAt > loginAt){
      showUpdateNotification();
    }
  });
}

export function showUpdateNotification(){
  const overlay = document.getElementById('update-overlay');
  overlay.style.display = 'flex';
  let secs = 10;
  const ti = setInterval(()=>{
    secs--;
    const el = document.getElementById('update-countdown');
    if(el) el.textContent = `Tự động đăng xuất sau ${secs} giây...`;
    if(secs <= 0){ clearInterval(ti); forceLogout(); }
  }, 1000);
}

export function forceLogout(){
  if(updateListener){ updateListener(); updateListener=null; }
  localStorage.removeItem('toeic_user');
  localStorage.removeItem('toeic_login_at');
  currentUser = null;
  document.getElementById('update-overlay').style.display='none';
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('app').style.display='none';
}
window.forceLogout=forceLogout;

export let heartbeatInterval = null;
export const ONLINE_THRESHOLD  = 2 * 60 * 1000;  // 2 min = online
export const AWAY_THRESHOLD    = 5 * 60 * 1000;  // 5 min = away (still show)
export const HEARTBEAT_INTERVAL = 30 * 1000;     // every 30s

export async function sendHeartbeat(){
  if(!currentUser) return;
  try{
    const today = new Date().toISOString().slice(0,10);
    const userRef = doc(db,'users',currentUser.username);
    const snap = await getDoc(userRef);
    const data = snap.data() || {};
    // Reset today counter if new day
    const lastOnlineDate = data.lastOnlineDate || '';
    const updateData = {
      lastSeen:        serverTimestamp(),
      lastTab:         currentTop || 'flashcard',
      lastOnlineDate:  today,
      totalOnlineSecs: increment(30),
    };
    if(lastOnlineDate !== today){
      updateData.todayOnlineSecs = 30; // reset for new day
    } else {
      updateData.todayOnlineSecs = increment(30);
    }
    await updateDoc(userRef, updateData);
  }catch(e){ /* silent fail */ }
}

export function startHeartbeat(){
  stopHeartbeat();
  sendHeartbeat(); // immediate
  heartbeatInterval = setInterval(()=>{
    // Chỉ gửi heartbeat khi tab đang thực sự mở & hiển thị (không tính tab bị đưa xuống nền)
    if(document.visibilityState === 'visible') sendHeartbeat();
  }, HEARTBEAT_INTERVAL);
  // Also send on tab focus
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState==='visible') sendHeartbeat();
  });
}

export function stopHeartbeat(){
  if(heartbeatInterval){ clearInterval(heartbeatInterval); heartbeatInterval=null; }
}

export function saveLastSessionLocal(){
  // Save to localStorage immediately - no async, no timing issues
  if(!currentUser || history.length===0) return;
  try{
    const cards = history.map(h=>({
      en:h.en, vn:h.vn, topic:h.topic,
      cardMode:h.cardMode, ok:h.ok
    }));
    const key = 'toeic_session_'+currentUser.username;
    localStorage.setItem(key, JSON.stringify({
      cards, date: new Date().toISOString().slice(0,10), count: cards.length
    }));
  }catch(e){ /* silent */ }
}

export async function saveLastSession(){
  saveLastSessionLocal(); // Always save to localStorage first
  if(!currentUser || history.length===0) return;
  try{
    const cards = history.map(h=>({
      en:h.en, vn:h.vn, topic:h.topic,
      cardMode:h.cardMode, ok:h.ok
    }));
    const user = currentUser.username; // capture before any async
    await updateDoc(doc(db,'users',user),{
      lastSessionCards: cards,
      lastSessionDate: new Date().toISOString().slice(0,10),
      lastSessionCount: cards.length,
    });
  }catch(e){ /* silent */ }
}

export async function loadLastSession(){
  if(!currentUser) return;
  if(history.length > 0) return;

  // Try localStorage first (instant, no network)
  try{
    const key = 'toeic_session_'+currentUser.username;
    const saved = localStorage.getItem(key);
    if(saved){
      const data = JSON.parse(saved);
      if(data?.cards?.length){
        setHistory(data.cards.map(c=>({
          en:c.en, vn:c.vn, topic:c.topic,
          cardMode:c.cardMode, ok:c.ok, userAnswer:'',
        })));
        return; // Got from localStorage, done
      }
    }
  }catch(e){ /* fallthrough to Firestore */ }

  // Fallback: try Firestore
  try{
    const snap = await getDoc(doc(db,'users',currentUser.username));
    const data = snap.data();
    if(!data?.lastSessionCards?.length) return;
    setHistory(data.lastSessionCards.map(c=>({
      en:c.en, vn:c.vn, topic:c.topic,
      cardMode:c.cardMode, ok:c.ok, userAnswer:'',
    })));
    // Also cache to localStorage for next time
    const key = 'toeic_session_'+currentUser.username;
    localStorage.setItem(key, JSON.stringify({
      cards: data.lastSessionCards, date: data.lastSessionDate
    }));
  }catch(e){ /* silent */ }
}

// ══════════════════════════════════════════════════════
//  DICTIONARY (Free Dictionary API)
// ══════════════════════════════════════════════════════
