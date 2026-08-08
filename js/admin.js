import { db } from './firebase-config.js';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { showConfirm, fmtTime, getVNDate } from './utils.js';
import { ONLINE_THRESHOLD, AWAY_THRESHOLD } from './auth.js';
import { loadRanking } from './flashcard.js';

export async function createUser(){
  const username    = document.getElementById('new-username').value.trim().toLowerCase();
  const displayName = document.getElementById('new-displayname').value.trim();
  const pin         = document.getElementById('new-pin').value.trim();
  const msgEl       = document.getElementById('admin-msg');
  msgEl.className='admin-msg';msgEl.textContent='';
  if(!username||!displayName||!pin||pin.length!==4||!/^\d+$/.test(pin)){
    msgEl.className='admin-msg err';msgEl.textContent='Điền đầy đủ: username, tên, PIN 4 số.';return;
  }
  try{
    const ref=doc(db,'users',username);
    const snap=await getDoc(ref);
    if(snap.exists()){msgEl.className='admin-msg err';msgEl.textContent='Username đã tồn tại.';return;}
    await setDoc(ref,{username,displayName,pin,isAdmin:false,streak:0,lastStudyDay:'',createdAt:serverTimestamp()});
    msgEl.className='admin-msg ok';msgEl.textContent=`✓ Tạo xong: ${displayName} (${username})`;
    document.getElementById('new-username').value='';
    document.getElementById('new-displayname').value='';
    document.getElementById('new-pin').value='';
    loadAdminUsers();
  }catch(e){msgEl.className='admin-msg err';msgEl.textContent='Lỗi: '+e.message;}
}
window.createUser=createUser;

export async function loadAdminUsers(){
  const listEl=document.getElementById('admin-user-list');
  listEl.innerHTML='<div style="color:var(--muted);font-size:13px;padding:8px 0">Đang tải...</div>';
  try{
    const snap=await getDocs(collection(db,'users'));
    const users=[];
    snap.forEach(d=>{ if(!d.data().isAdmin) users.push({id:d.id,...d.data()}); });
    if(users.length===0){listEl.innerHTML='<div style="color:var(--muted);font-size:13px">Chưa có học viên nào.</div>';return;}
    listEl.innerHTML=users.map(u=>{
      const ls=u.lastSeen?.toMillis?.();
      let onlineStr='Chưa online';
      if(ls){
        const d=Date.now()-ls, mins=Math.floor(d/60000), hrs=Math.floor(mins/60), days=Math.floor(hrs/24);
        onlineStr=days>0?'Online '+days+' ngày trước':hrs>0?'Online '+hrs+' giờ trước':mins>0?'Online '+mins+' phút trước':'Online vừa xong';
      }
      return `<div class="admin-user-row">
        <div style="flex:1">
          <div class="admin-user-name">${u.displayName}</div>
          <div class="admin-user-info">@${u.username} · PIN: ${u.pin} · 🔥${u.streak||0} · ${onlineStr}</div>
        </div>
        <button class="admin-user-del" style="color:var(--green);border-color:var(--green)" onclick="setUserStreak('${u.id}','${u.displayName}',${u.streak||0})">Sửa streak</button>
        <button class="admin-user-del" style="color:var(--yellow);border-color:var(--yellow)" onclick="resetStreak('${u.id}','${u.displayName}')">Reset streak</button>
        <button class="admin-user-del" style="color:var(--accent);border-color:var(--accent)" onclick="resetUserRanking('${u.id}','${u.displayName}')">Xóa BXH</button>
        <button class="admin-user-del" onclick="deleteUser('${u.id}','${u.displayName}')">Xóa tài khoản</button>
      </div>`;
    }).join('');;
  }catch(e){listEl.innerHTML='<div style="color:var(--red);font-size:13px">Lỗi tải danh sách.</div>';}
}

export async function deleteUser(username, displayName){
  showConfirm('Xóa tài khoản', `Xóa tài khoản của "${displayName}"? Không thể hoàn tác.`, async ()=>{
  try{
    await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js").then(async({deleteDoc})=>{
      await deleteDoc(doc(db,'users',username));
    });
    loadAdminUsers();
  }catch(e){alert('Lỗi xóa: '+e.message);}
  }); // end showConfirm
}
window.deleteUser=deleteUser;

export async function deleteUserRanking(username, displayName, period){
  showConfirm('Xóa BXH', `Xóa điểm xếp hạng của "${displayName}"?`, async ()=>{
    try{
      const {deleteDoc:dd} = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const cols = period==='all'
        ? ['ranking_week','ranking_month','ranking_all']
        : [`ranking_${period}`];
      for(const col of cols){
        const snap = await getDocs(collection(db, col));
        for(const d of snap.docs){
          if(d.data().username === username) await dd(d.ref);
        }
      }
      loadRanking(); // refresh
    } catch(e){ alert('Lỗi: '+e.message); }
  });
}
window.deleteUserRanking=deleteUserRanking;

export async function resetStreak(username, displayName){
  showConfirm('Reset Streak', `Xóa streak của "${displayName}"? Streak sẽ về 0.`, async ()=>{
    try{
      await updateDoc(doc(db,'users',username),{streak:0, lastStudyDay:''});
      const msgEl=document.getElementById('admin-msg');
      msgEl.className='admin-msg ok';
      msgEl.textContent=`✓ Đã reset streak của ${displayName}.`;
      loadAdminUsers();
    }catch(e){
      const msgEl=document.getElementById('admin-msg');
      msgEl.className='admin-msg err';
      msgEl.textContent='Lỗi: '+e.message;
    }
  });
}
window.resetStreak=resetStreak;

export async function setUserStreak(username, displayName, currentStreak){
  const input = prompt(`Nhập số streak mới cho "${displayName}" (hiện tại: ${currentStreak}):`, currentStreak);
  if(input === null) return; // bấm Hủy
  const val = parseInt(input.trim(), 10);
  if(isNaN(val) || val < 0){
    alert('Vui lòng nhập một số nguyên không âm.');
    return;
  }
  const msgEl=document.getElementById('admin-msg');
  try{
    // Đặt lastStudyDay = hôm nay để streak không tự rớt về 1 ở lần đăng nhập kế tiếp
    await updateDoc(doc(db,'users',username),{streak:val, lastStudyDay:getVNDate(0)});
    msgEl.className='admin-msg ok';
    msgEl.textContent=`✓ Đã đặt streak của ${displayName} = ${val}.`;
    loadAdminUsers();
  }catch(e){
    msgEl.className='admin-msg err';
    msgEl.textContent='Lỗi: '+e.message;
  }
}
window.setUserStreak=setUserStreak;

export async function resetUserRanking(username, displayName){
  showConfirm('Xóa BXH', `Xóa toàn bộ điểm xếp hạng của "${displayName}"? Không thể hoàn tác.`, async ()=>{
    const msgEl=document.getElementById('admin-msg');
    msgEl.className='admin-msg';msgEl.textContent='Đang xóa...';
    try{
      const {deleteDoc:dd} = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const cols = ['ranking_week','ranking_month','ranking_all'];
      // Delete all docs for this user across all ranking collections
      for(const col of cols){
        const snap = await getDocs(collection(db, col));
        for(const d of snap.docs){
          if(d.data().username === username) await dd(d.ref);
        }
      }
      msgEl.className='admin-msg ok';
      msgEl.textContent=`✓ Đã xóa BXH của ${displayName}.`;
    } catch(e){
      msgEl.className='admin-msg err';
      msgEl.textContent='Lỗi: '+e.message;
    }
  });
}
window.resetUserRanking=resetUserRanking;

export async function doResetRanking(period){
  const msgEl = document.getElementById('rank-reset-msg');
  msgEl.className='admin-msg';msgEl.textContent='Đang xóa...';
  try{
    const {getDocs:gd2, deleteDoc:dd2, collection:col2} = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const periods = period==='all_periods' ? ['ranking_week','ranking_month','ranking_all'] : [`ranking_${period}`];
    let total=0;
    for(const col of periods){
      const snap = await gd2(col2(db, col));
      for(const d of snap.docs){ await dd2(d.ref); total++; }
    }
    msgEl.className='admin-msg ok';msgEl.textContent=`✓ Đã xóa ${total} bản ghi.`;
  }catch(e){
    msgEl.className='admin-msg err';msgEl.textContent='Lỗi: '+e.message;
  }
}
window.doResetRanking=doResetRanking;
export function resetRanking(period){
  const labels={week:'tuần này',month:'tháng này',all:'tổng cộng',all_periods:'tất cả các kỳ'};
  showConfirm('Xóa bảng xếp hạng', `Bạn chắc chắn muốn xóa BXH ${labels[period]}? Không thể hoàn tác.`, ()=>doResetRanking(period));
}
window.resetRanking=resetRanking;


// ══════════════════════════════════════════════════════
//  GRAMMAR DATA
// ══════════════════════════════════════════════════════
export async function pushForceUpdate(){
  showConfirm('Thông báo cập nhật', 'Tất cả học viên đang online sẽ nhận thông báo và bị đăng xuất để load phiên bản mới. Tiếp tục?', async ()=>{
    try{
      const msgEl=document.getElementById('force-update-msg');
      msgEl.className='admin-msg';msgEl.textContent='Đang gửi...';
      await setDoc(doc(db,'config','app'),{forceLogoutAt: serverTimestamp()},{merge:true});
      msgEl.className='admin-msg ok';msgEl.textContent='✓ Đã gửi thông báo! Học viên sẽ được nhắc đăng nhập lại.';
    }catch(e){
      document.getElementById('force-update-msg').className='admin-msg err';
      document.getElementById('force-update-msg').textContent='Lỗi: '+e.message;
    }
  });
}
window.pushForceUpdate=pushForceUpdate;

// ── FUN WRONG STREAK MESSAGES ─────────────────────────────────────
export async function loadOnlineUsers(){
  const listEl = document.getElementById('admin-online-list');
  const countEl = document.getElementById('online-count');
  if(!listEl) return;
  listEl.innerHTML = '<div style="color:var(--muted);font-size:12px;">Đang tải...</div>';
  try{
    const snap = await getDocs(collection(db,'users'));
    const now  = Date.now();
    const users = [];
    snap.forEach(d=>{
      const u = d.data();
      if(u.isAdmin) return;
      const lastSeen = u.lastSeen?.toMillis?.() || 0;
      const diff = now - lastSeen;
      const isOnline = diff < ONLINE_THRESHOLD;
      const isAway   = diff < AWAY_THRESHOLD;
      if(isOnline || isAway){
        users.push({ name: u.displayName||u.username, lastSeen, diff, isOnline, tab: u.lastTab||'flashcard' });
      }
    });
    users.sort((a,b)=>b.lastSeen-a.lastSeen);

    const onlineCount = users.filter(u=>u.isOnline).length;
    if(countEl) countEl.textContent = onlineCount > 0 ? `(${onlineCount} người)` : '';

    if(users.length===0){
      listEl.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px 0;">Không có ai online.</div>';
      return;
    }

    const TAB_LABELS = {flashcard:'📚 Flashcard',grammar:'✍️ Ngữ pháp',minitest:'🎯 Mini Test',dashboard:'📈 Dashboard'};

    listEl.innerHTML = users.map(u=>{
      const mins = Math.floor(u.diff/60000);
      const secs = Math.floor((u.diff%60000)/1000);
      const timeStr = u.diff < 60000 ? `${secs}s trước` : `${mins} phút trước`;
      const badgeClass = u.isOnline ? 'badge-online' : 'badge-away';
      const badgeText  = u.isOnline ? '🟢 Online' : '🟡 Vừa rời';
      const tabLabel   = TAB_LABELS[u.tab] || u.tab;
      const todayStr   = fmtTime(u.todayOnlineSecs);
      const totalStr   = fmtTime(u.totalOnlineSecs);
      return `<div class="admin-online-row">
        <div style="flex:1">
          <div class="admin-online-name">${u.name}</div>
          <div class="admin-online-time">${tabLabel} · ${timeStr}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:3px;">
            📅 Hôm nay: <b style="color:var(--text)">${todayStr}</b>
            &nbsp;·&nbsp;
            📊 Tổng: <b style="color:var(--text)">${totalStr}</b>
          </div>
        </div>
        <span class="admin-online-badge ${badgeClass}">${badgeText}</span>
      </div>`;
    }).join('');

    // Auto-refresh every 30s while admin panel is open
    setTimeout(()=>{
      if(document.getElementById('admin-panel')?.style.display==='block') loadOnlineUsers();
    }, 30000);

  }catch(e){
    if(listEl) listEl.innerHTML='<div style="color:var(--red);font-size:12px;">Lỗi: '+e.message+'</div>';
  }
}

// ── PERSIST LAST SESSION ─────────────────────────────────────────
