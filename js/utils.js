// Small stateless helpers shared across modules.

export function getVNDate(offsetDays=0){
  // Vietnam timezone UTC+7, returns "YYYY-MM-DD"
  const ms = Date.now() + 7*60*60*1000 + offsetDays*86400000;
  return new Date(ms).toISOString().slice(0,10);
}

export function vnDateFromMs(ms, offsetDays=0){
  // Giống getVNDate() nhưng nhận mốc thời gian (ms) truyền vào thay vì Date.now() —
  // dùng để tính ngày dựa trên GIỜ SERVER thay vì đồng hồ thiết bị.
  const shifted = ms + 7*60*60*1000 + offsetDays*86400000;
  return new Date(shifted).toISOString().slice(0,10);
}

export function normalize(s){ return s.toLowerCase().trim().replace(/\s+/g,' '); }

export function levenshtein(a, b){
  a=a.toLowerCase(); b=b.toLowerCase();
  const m=a.length, n=b.length;
  if(m===0) return n;
  if(n===0) return m;
  const dp=new Array(n+1);
  for(let j=0;j<=n;j++) dp[j]=j;
  for(let i=1;i<=m;i++){
    let prev=dp[0]; dp[0]=i;
    for(let j=1;j<=n;j++){
      const tmp=dp[j];
      dp[j]= a[i-1]===b[j-1] ? prev : 1+Math.min(prev,dp[j],dp[j-1]);
      prev=tmp;
    }
  }
  return dp[n];
}
export function acceptableMatch(input,card,cardMode){
  const inp=normalize(input);
  const pool=cardMode==='en-vn'?[card.vn,...(card.vn_alt||[])]:[card.en,...(card.en_alt||[])];
  // Tách theo cả "/" và "," — ví dụ "lối mòn, đường đi" hay "gọi món/đơn hàng"
  // đều chấp nhận đúng khi học viên gõ MỘT trong các nghĩa đó.
  const expanded=new Set();
  pool.forEach(a=>{
    expanded.add(normalize(a));
    String(a).split(/[/,]/).forEach(part=>expanded.add(normalize(part.trim())));
  });
  return expanded.has(inp);
}

export function showConfirm(title, msg, onOk, onCancel){
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-msg').textContent   = msg;
  const overlay = document.getElementById('confirm-modal');
  overlay.classList.add('show');
  const okBtn     = document.getElementById('modal-ok');
  const cancelBtn = document.getElementById('modal-cancel');
  function cleanup(){ overlay.classList.remove('show'); okBtn.onclick=null; cancelBtn.onclick=null; }
  okBtn.onclick     = ()=>{ cleanup(); onOk(); };
  cancelBtn.onclick = ()=>{ cleanup(); if(onCancel) onCancel(); };
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
