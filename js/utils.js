// Small stateless helpers shared across modules.

export function getVNDate(offsetDays=0){
  // Vietnam timezone UTC+7, returns "YYYY-MM-DD"
  const ms = Date.now() + 7*60*60*1000 + offsetDays*86400000;
  return new Date(ms).toISOString().slice(0,10);
}

export function normalize(s){ return s.toLowerCase().trim().replace(/\s+/g,' '); }
export function acceptableMatch(input,card,cardMode){
  const inp=normalize(input);
  const pool=cardMode==='en-vn'?[card.vn,...(card.vn_alt||[])]:[card.en,...(card.en_alt||[])];
  // Split each answer by "/" — e.g. "gọi món/đơn hàng" also accepts "gọi món" or "đơn hàng"
  const expanded=new Set();
  pool.forEach(a=>{
    expanded.add(normalize(a));
    String(a).split('/').forEach(part=>expanded.add(normalize(part.trim())));
  });
  return expanded.has(inp);
}

export function showConfirm(title, msg, onOk){
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-msg').textContent   = msg;
  const overlay = document.getElementById('confirm-modal');
  overlay.classList.add('show');
  const okBtn     = document.getElementById('modal-ok');
  const cancelBtn = document.getElementById('modal-cancel');
  function cleanup(){ overlay.classList.remove('show'); okBtn.onclick=null; cancelBtn.onclick=null; }
  okBtn.onclick     = ()=>{ cleanup(); onOk(); };
  cancelBtn.onclick = ()=>{ cleanup(); };
}
export function getWeekKey(offsetDays=0) {
  // Thứ Hai của tuần hiện tại, tính theo giờ Việt Nam cố định (UTC+7),
  // không phụ thuộc múi giờ của thiết bị/trình duyệt.
  const ms = Date.now() + 7*60*60*1000 + offsetDays*86400000;
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0=CN..6=T7 (an toàn vì ms đã dịch theo VN)
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0,10);
}

export function getVNMonth(offsetDays=0) {
  // "YYYY-MM" theo giờ Việt Nam cố định (UTC+7)
  const ms = Date.now() + 7*60*60*1000 + offsetDays*86400000;
  return new Date(ms).toISOString().slice(0,7);
}

// ── Ranking ───────────────────────────────────────────────────────
export const fmtSecs = (s) => {
  if(!s || s===0) return 'chưa có';
  if(s < 60) return '< 1 phút';
  const m=Math.floor(s/60), h=Math.floor(m/60);
  return h>0 ? h+'h '+m%60+'p' : m+'p';
};
export const fmtTime = (secs) => {
  if(!secs || secs===0) return 'chưa có';
  if(secs < 60) return '< 1 phút';
  const m=Math.floor(secs/60), h=Math.floor(m/60);
  if(h>0) return h+'h '+(m%60)+'p';
  return m+' phút';
};
// ── HEARTBEAT & ONLINE STATUS ─────────────────────────────────────
