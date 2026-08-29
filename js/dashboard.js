import { db } from './firebase-config.js';
import { doc, getDoc, getDocs, collection, query, where, limit } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { currentUser } from './auth.js';
import { history, topics } from './flashcard.js';

export async function loadDashboard(){
  const loadEl=document.getElementById('dashboard-loading');
  const contEl=document.getElementById('dashboard-content');
  loadEl.style.display='block'; contEl.style.display='none';
  try{
    if(!currentUser){loadEl.textContent='Vui lòng đăng nhập.';return;}

    // Get all-time stats
    const allSnap=await getDoc(doc(db,'ranking_all',currentUser.username));
    const allData=allSnap.exists()?allSnap.data():{correct:0,wrong:0,pct:0};

    // Get last 14 sessions
    // No orderBy to avoid composite index requirement — sort client-side
    const sessSnap=await getDocs(
      query(collection(db,'sessions'),where('username','==',currentUser.username),limit(50))
    );
    const sessions=[];
    sessSnap.forEach(d=>sessions.push(d.data()));
    // Sort by createdAt client-side, take last 14
    sessions.sort((a,b)=>{
      const ta=a.createdAt?.toMillis?.()||0;
      const tb=b.createdAt?.toMillis?.()||0;
      return ta-tb;
    });
    sessions.splice(0, Math.max(0, sessions.length-14));

    // Build 7-day chart data
    const dayMap={};
    for(let i=6;i>=0;i--){
      const d=new Date(); d.setDate(d.getDate()-i);
      const key=d.toISOString().slice(0,10);
      dayMap[key]={correct:0,label:d.toLocaleDateString('vi-VN',{weekday:'short'})};
    }
    sessions.forEach(s=>{
      if(s.createdAt){
        const key=new Date(s.createdAt.toDate()).toISOString().slice(0,10);
        if(dayMap[key]) dayMap[key].correct+=s.correct||0;
      }
    });

    // User streak & badges
    const userSnap=await getDoc(doc(db,'users',currentUser.username));
    const userData=userSnap.data()||{};

    // Render stats row
    const streak=userData.streak||0;
    const badges=(userData.badges||[]).length;
    document.getElementById('dash-stats-row').innerHTML=`
      <div class="sum-stat-box"><div class="val" style="color:var(--green)">${allData.correct||0}</div><div class="lbl">Tổng đúng</div></div>
      <div class="sum-stat-box"><div class="val" style="color:var(--accent)">${allData.pct||0}%</div><div class="lbl">Tỉ lệ</div></div>
      <div class="sum-stat-box"><div class="val" style="color:var(--yellow)">🔥${streak}</div><div class="lbl">Streak</div></div>
      <div class="sum-stat-box"><div class="val" style="color:var(--gold)">🏅${badges}</div><div class="lbl">Huy hiệu</div></div>
    `;

    // Render 7-day chart
    const days=Object.values(dayMap);
    const maxVal=Math.max(...days.map(d=>d.correct),1);
    document.getElementById('dash-chart').innerHTML=days.map(d=>`
      <div class="dash-bar-col">
        <div class="dash-bar-val" style="min-height:16px;">${d.correct||''}</div>
        <div class="dash-bar" style="height:${Math.max((d.correct/maxVal)*60,d.correct>0?3:1)}px;opacity:${d.correct>0?1:.25}"></div>
        <div class="dash-bar-label">${d.label}</div>
      </div>`).join('');

    // Topic accuracy from ranking data — use session history if available, else show placeholder
    const topicMap={};
    sessions.forEach(s=>{/* sessions don't have topic breakdown — use current history */});
    // Use current session history for topic accuracy
    const topicAcc={};
    history.forEach(h=>{
      if(!topicAcc[h.topic]) topicAcc[h.topic]={c:0,t:0};
      topicAcc[h.topic].t++;
      if(h.ok) topicAcc[h.topic].c++;
    });
    const topicEntries=Object.entries(topicAcc).sort((a,b)=>b[1].t-a[1].t).slice(0,8);
    if(topicEntries.length>0){
      document.getElementById('dash-topics').innerHTML=topicEntries.map(([t,v])=>{
        const pct=Math.round((v.c/v.t)*100);
        return `<div class="topic-acc-row">
          <div class="topic-acc-label"><span>${t}</span><span style="color:${pct>=80?'var(--green)':pct>=50?'var(--yellow)':'var(--red)'}">${pct}% (${v.c}/${v.t})</span></div>
          <div class="topic-acc-bar"><div class="topic-acc-fill" style="width:${pct}%;background:${pct>=80?'var(--green)':pct>=50?'var(--yellow)':'var(--red)'}"></div></div>
        </div>`;
      }).join('');
    } else {
      document.getElementById('dash-topics').innerHTML='<div style="color:var(--muted);font-size:13px;">Chưa có dữ liệu. Hãy luyện tập để xem phân tích theo chủ đề!</div>';
    }

    if(currentUser.isAdmin) await loadClassDashboard();
    await loadMyVocabTestResults();
    loadEl.style.display='none'; contEl.style.display='block';
  } catch(e){
    loadEl.textContent='Lỗi tải dashboard: '+e.message;
    console.error(e);
  }
}

export async function loadMyVocabTestResults(){
  const el = document.getElementById('dash-vocabtests');
  if(!el || !currentUser) return;
  el.innerHTML = '<div style="color:var(--muted);font-size:12px;">Đang tải...</div>';
  try{
    // Không dùng orderBy kèm where để tránh cần composite index — lọc & sắp xếp ở client
    const snap = await getDocs(query(collection(db,'vocab_tests'), where('username','==',currentUser.username)));
    const results = [];
    snap.forEach(d=>{ const data=d.data(); if(data.returned) results.push(data); });
    results.sort((a,b)=>{
      const ta=a.submittedAt?.toMillis?.()||0, tb=b.submittedAt?.toMillis?.()||0;
      return tb-ta;
    });
    if(!results.length){
      el.innerHTML = '<div style="color:var(--muted);font-size:13px;">Chưa có bài kiểm tra từ vựng nào được trả.</div>';
      return;
    }
    el.innerHTML = results.slice(0,10).map(data=>{
      const time = data.submittedAt?.toDate ? data.submittedAt.toDate().toLocaleString('vi-VN') : '';
      const words = data.words||[];
      const grades = data.grades||[];
      const correctN = grades.filter(g=>g==='correct').length;
      const wrongN = grades.filter(g=>g==='wrong').length;
      return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-weight:700;font-family:'Space Grotesk',sans-serif;color:${correctN>=wrongN?'var(--green)':'var(--yellow)'};">${correctN}/${words.length} đúng</div>
          <div style="font-size:11px;color:var(--muted);">${time}</div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${words.map((w,i)=>{
            const g=grades[i];
            const color = g==='correct' ? 'var(--green)' : g==='wrong' ? 'var(--red)' : 'var(--muted)';
            const icon  = g==='correct' ? '✓' : g==='wrong' ? '✗' : '·';
            return `<span style="font-size:12px;background:var(--surface2);border:1px solid ${color};color:${color};border-radius:6px;padding:3px 8px;">${icon} ${w}</span>`;
          }).join('')}
        </div>
      </div>`;
    }).join('');
  }catch(e){
    el.innerHTML = '<div style="color:var(--red);font-size:12px;">Lỗi: '+e.message+'</div>';
  }
}

export async function loadClassDashboard(){
  let sec = document.getElementById('dash-class');
  if(!sec){
    sec = document.createElement('div');
    sec.id = 'dash-class';
    document.getElementById('dashboard-content').appendChild(sec);
  }
  sec.innerHTML = '<div class="badges-title" style="margin-top:20px;">Tong hop lop hoc</div><div style="color:var(--muted);font-size:12px;">Dang tai...</div>';
  try{
    const snap = await getDocs(collection(db,'ranking_all'));
    const students = [];
    snap.forEach(d => students.push({username:d.id,...d.data()}));
    if(!students.length){ sec.innerHTML=''; return; }

    const totalCorrect = students.reduce((s,u)=>s+(u.correct||0),0);
    const totalAnswered = students.reduce((s,u)=>s+(u.correct||0)+(u.wrong||0),0);
    const classAvg = totalAnswered>0 ? Math.round(totalCorrect/totalAnswered*100) : 0;
    students.sort((a,b)=>(b.correct||0)-(a.correct||0));

    const userSnaps = await Promise.all(students.map(s=>getDoc(doc(db,'users',s.username))));
    const streakMap = {};
    userSnaps.forEach(d=>{ if(d.exists()) streakMap[d.id]=d.data()?.streak||0; });

    const rows = students.map((s,i)=>{
      const total=(s.correct||0)+(s.wrong||0);
      const pct=total>0?Math.round((s.correct||0)/total*100):0;
      const streak=streakMap[s.username]||0;
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:6px;">'
        +'<div style="font-weight:700;font-size:13px;width:18px;color:var(--muted);">'+(i+1)+'</div>'
        +'<div style="flex:1;">'
          +'<div style="font-weight:600;font-size:13px;">'+(s.displayName||s.username)+'</div>'
          +'<div style="height:5px;background:var(--surface2);border-radius:3px;margin-top:4px;">'
            +'<div style="height:100%;width:'+Math.round(pct*1.2)+'px;max-width:100%;background:var(--accent);border-radius:3px;"></div>'
          +'</div>'
        +'</div>'
        +'<div style="text-align:right;">'
          +'<div style="font-size:13px;font-weight:700;color:var(--green);">'+(s.correct||0)+' đúng</div>'
          +'<div style="font-size:11px;color:var(--muted);">'+pct+'% · '+streak+' streak</div>'
        +'</div>'
        +'</div>';
    }).join('');

    sec.innerHTML = '<div class="badges-title" style="margin-top:20px;">Tổng hợp lớp học</div>'
      +'<div class="sum-stats" style="margin-bottom:12px;">'
        +'<div class="sum-stat-box"><div class="val" style="color:var(--green)">'+totalCorrect+'</div><div class="lbl">Tong dung</div></div>'
        +'<div class="sum-stat-box"><div class="val" style="color:var(--accent)">'+classAvg+'%</div><div class="lbl">TB lớp</div></div>'
        +'<div class="sum-stat-box"><div class="val" style="color:var(--gold)">'+students.length+'</div><div class="lbl">Học viên</div></div>'
      +'</div>'
      +rows;
  }catch(e){
    sec.innerHTML='<div style="color:var(--red);font-size:12px;">Loi: '+e.message+'</div>';
  }
}


// ── FORCE UPDATE / RELOAD NOTIFICATION ────────────────────────────
