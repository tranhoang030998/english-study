import { db } from './firebase-config.js';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { showConfirm, getVNDate } from './utils.js';
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
      return `<div class="admin-online-row">
        <div style="flex:1">
          <div class="admin-online-name">${u.name}</div>
          <div class="admin-online-time">${tabLabel} · ${timeStr}</div>
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

// ── Xem bài kiểm tra từ vựng học viên đã nộp ────────────────────────
export async function loadVocabTests(){
  const listEl = document.getElementById('admin-vt-list');
  const countEl = document.getElementById('vt-submit-count');
  if(!listEl) return;
  try{
    const q = query(collection(db,'vocab_tests'), orderBy('submittedAt','desc'), limit(100));
    const snap = await getDocs(q);
    if(countEl) countEl.textContent = `(${snap.size} bài gần nhất)`;
    if(snap.empty){
      listEl.innerHTML = '<div style="color:var(--muted);font-size:13px;">Chưa có bài nộp nào.</div>';
      return;
    }

    // Gom bài nộp theo từng học viên
    const byStudent = new Map();
    snap.docs.forEach(d=>{
      const data = d.data();
      const key = data.username;
      if(!byStudent.has(key)) byStudent.set(key, { displayName: data.displayName||data.username, subs: [] });
      byStudent.get(key).subs.push({ id: d.id, data });
    });
    // Học viên có bài nộp gần nhất lên đầu
    const students = Array.from(byStudent.entries()).sort((a,b)=>{
      const ta = a[1].subs[0]?.data.submittedAt?.toMillis?.() || 0;
      const tb = b[1].subs[0]?.data.submittedAt?.toMillis?.() || 0;
      return tb-ta;
    });

    const toolbarHtml = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);cursor:pointer;">
          <input type="checkbox" id="vt-select-all" onclick="toggleAllVocabSelect(this.checked)"> Chọn tất cả
        </label>
        <button class="admin-btn danger" style="padding:6px 12px;font-size:12px;" onclick="deleteSelectedVocabTests()">🗑 Xóa mục đã chọn</button>
        <button class="admin-btn danger" style="padding:6px 12px;font-size:12px;background:#2d0808;border-color:#7f1d1d;color:#fca5a5;" onclick="deleteAllVocabTests()">🗑 Xóa TẤT CẢ bài nộp</button>
      </div>`;

    const studentsHtml = students.map(([username, info])=>{
      const subCount = info.subs.length;
      const subsHtml = info.subs.map(({id, data})=>renderVocabSubmission(id, data)).join('');
      return `<details style="background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;">
        <summary style="padding:10px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;">
          <span style="font-weight:700;font-family:'Space Grotesk',sans-serif;font-size:14px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${info.displayName}</span>
          <span style="font-size:11px;color:var(--muted);white-space:nowrap;">${subCount} bài nộp</span>
        </summary>
        <div style="padding:0 12px 12px;display:flex;flex-direction:column;gap:8px;">${subsHtml}</div>
      </details>`;
    }).join('');

    listEl.innerHTML = toolbarHtml + studentsHtml;
  }catch(e){
    listEl.innerHTML = '<div style="color:var(--red);font-size:12px;">Lỗi: '+e.message+'</div>';
  }
}
window.loadVocabTests = loadVocabTests;

function renderVocabSubmission(docId, data){
  const time = data.submittedAt?.toDate ? data.submittedAt.toDate().toLocaleString('vi-VN') : '';
  const words = (data.words||[]);
  const grades = (data.grades||[]);
  const correctN = grades.filter(g=>g==='correct').length;
  const wrongN   = grades.filter(g=>g==='wrong').length;
  const gradedN  = correctN + wrongN;
  const statusBadge = data.returned
    ? `<span id="vt-badge-${docId}" style="font-size:10px;color:var(--green);border:1px solid var(--green);border-radius:6px;padding:1px 6px;white-space:nowrap;">✓ đã trả</span>`
    : gradedN>0
      ? `<span id="vt-badge-${docId}" style="font-size:10px;color:var(--yellow);border:1px solid var(--yellow);border-radius:6px;padding:1px 6px;white-space:nowrap;">${correctN}/${words.length} đúng</span>`
      : `<span id="vt-badge-${docId}" style="font-size:10px;color:var(--muted);border:1px solid var(--border);border-radius:6px;padding:1px 6px;white-space:nowrap;">chưa chấm</span>`;
  return `<details style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;">
    <summary style="padding:8px 10px;cursor:pointer;display:flex;align-items:center;gap:8px;">
      <input type="checkbox" class="vt-select-cb" data-id="${docId}" onclick="event.stopPropagation()">
      <span style="font-size:12px;color:var(--text);flex:1;">📅 ${time}</span>
      ${statusBadge}
      <button onclick="event.stopPropagation();deleteVocabTest('${docId}')" style="background:transparent;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:2px 4px;flex-shrink:0;">🗑</button>
    </summary>
    <div style="padding:0 10px 10px;">
      <div id="vt-summary-${docId}" style="font-size:12px;color:var(--muted);margin-bottom:8px;">${gradedN>0 ? `Đã chấm: ${gradedN}/${words.length} · <span style="color:var(--green);">✓ ${correctN} đúng</span> · <span style="color:var(--red);">✗ ${wrongN} sai</span>` : ''}</div>
      <div style="display:flex;flex-direction:column;gap:5px;">
        ${words.map((w,i)=>{
          const g = grades[i];
          const borderColor = g==='correct' ? 'var(--green)' : g==='wrong' ? 'var(--red)' : 'var(--border)';
          return `<div id="vt-word-${docId}-${i}" style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--bg);border:1px solid ${borderColor};border-radius:6px;">
            <span style="flex:1;font-size:13px;font-family:'Space Grotesk',sans-serif;">${i+1}. ${w}</span>
            <button class="vt-ok-btn" onclick="gradeVocabWord('${docId}',${i},'correct')" style="background:none;border:none;cursor:pointer;font-size:15px;opacity:${g==='correct'?'1':'.4'};">✅</button>
            <button class="vt-no-btn" onclick="gradeVocabWord('${docId}',${i},'wrong')" style="background:none;border:none;cursor:pointer;font-size:15px;opacity:${g==='wrong'?'1':'.4'};">❌</button>
          </div>`;
        }).join('')}
      </div>
      <div id="vt-return-${docId}" style="margin-top:10px;">
        ${data.returned
          ? `<div style="font-size:12px;color:var(--green);text-align:center;padding:8px;background:var(--green-bg);border-radius:8px;">✓ Đã trả bài cho học viên</div>`
          : `<button onclick="returnVocabTest('${docId}')" style="width:100%;padding:9px;background:var(--accent);color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">📤 Trả bài chấm</button>`}
      </div>
    </div>
  </details>`;
}

export function toggleAllVocabSelect(checked){
  document.querySelectorAll('.vt-select-cb').forEach(cb=>{ cb.checked = checked; });
}
window.toggleAllVocabSelect = toggleAllVocabSelect;

export async function deleteVocabTest(docId){
  showConfirm('Xóa bài nộp', 'Xóa bài nộp này? Không thể hoàn tác.', async ()=>{
    await deleteDoc(doc(db,'vocab_tests',docId));
    loadVocabTests();
  });
}
window.deleteVocabTest = deleteVocabTest;

export async function deleteSelectedVocabTests(){
  const ids = Array.from(document.querySelectorAll('.vt-select-cb:checked')).map(cb=>cb.dataset.id);
  if(!ids.length){ alert('Bạn chưa chọn bài nộp nào.'); return; }
  showConfirm('Xóa các bài đã chọn', `Xóa ${ids.length} bài nộp đã chọn? Không thể hoàn tác.`, async ()=>{
    await Promise.all(ids.map(id=>deleteDoc(doc(db,'vocab_tests',id))));
    loadVocabTests();
  });
}
window.deleteSelectedVocabTests = deleteSelectedVocabTests;

export async function deleteAllVocabTests(){
  showConfirm('Xóa TẤT CẢ bài nộp', 'Xóa toàn bộ bài kiểm tra từ vựng đã nộp (kể cả bài chưa chấm)? Không thể hoàn tác.', async ()=>{
    const snap = await getDocs(collection(db,'vocab_tests'));
    await Promise.all(snap.docs.map(d=>deleteDoc(d.ref)));
    loadVocabTests();
  });
}
window.deleteAllVocabTests = deleteAllVocabTests;

export async function gradeVocabWord(docId, wordIndex, verdict){
  try{
    const ref = doc(db,'vocab_tests',docId);
    const snap = await getDoc(ref);
    if(!snap.exists()) return;
    const data = snap.data();
    const grades = Array.isArray(data.grades) ? [...data.grades] : [];
    while(grades.length < data.words.length) grades.push(null);
    // Bấm lại đúng verdict đang chọn thì bỏ chấm (toggle về chưa chấm)
    grades[wordIndex] = grades[wordIndex]===verdict ? null : verdict;
    await updateDoc(ref, { grades });
    // Cập nhật trực tiếp trên giao diện tại đúng dòng vừa chấm — KHÔNG load lại
    // toàn bộ danh sách, để tránh làm các khung đang mở bị đóng lại.
    updateVocabWordUI(docId, wordIndex, grades, data.words.length, data.returned);
  }catch(e){
    alert('Lỗi khi chấm điểm: '+e.message);
  }
}
window.gradeVocabWord = gradeVocabWord;

function updateVocabWordUI(docId, wordIndex, grades, totalWords, returned){
  const g = grades[wordIndex];
  const rowEl = document.getElementById(`vt-word-${docId}-${wordIndex}`);
  if(rowEl){
    rowEl.style.borderColor = g==='correct' ? 'var(--green)' : g==='wrong' ? 'var(--red)' : 'var(--border)';
    const okBtn = rowEl.querySelector('.vt-ok-btn');
    const noBtn = rowEl.querySelector('.vt-no-btn');
    if(okBtn) okBtn.style.opacity = g==='correct' ? '1' : '.4';
    if(noBtn) noBtn.style.opacity = g==='wrong' ? '1' : '.4';
  }
  const correctN = grades.filter(x=>x==='correct').length;
  const wrongN   = grades.filter(x=>x==='wrong').length;
  const gradedN  = correctN + wrongN;
  const summaryEl = document.getElementById(`vt-summary-${docId}`);
  if(summaryEl){
    summaryEl.innerHTML = gradedN>0 ? `Đã chấm: ${gradedN}/${totalWords} · <span style="color:var(--green);">✓ ${correctN} đúng</span> · <span style="color:var(--red);">✗ ${wrongN} sai</span>` : '';
  }
  const badgeEl = document.getElementById(`vt-badge-${docId}`);
  if(badgeEl && !returned){
    if(gradedN>0){
      badgeEl.textContent = `${correctN}/${totalWords} đúng`;
      badgeEl.style.color = 'var(--yellow)';
      badgeEl.style.borderColor = 'var(--yellow)';
    } else {
      badgeEl.textContent = 'chưa chấm';
      badgeEl.style.color = 'var(--muted)';
      badgeEl.style.borderColor = 'var(--border)';
    }
  }
}

export async function returnVocabTest(docId){
  showConfirm('Trả bài chấm', 'Gửi kết quả chấm cho học viên xem trong Dashboard? Học viên sẽ thấy được từ nào đúng, từ nào sai.', async ()=>{
    await updateDoc(doc(db,'vocab_tests',docId), { returned: true, returnedAt: serverTimestamp() });
    loadVocabTests();
  });
}
window.returnVocabTest = returnVocabTest;
