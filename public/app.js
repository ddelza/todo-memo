// 할일 메모 — 웹과 안드로이드 앱(WebView)이 같은 코드를 쓴다.
// 데이터: Firestore users/{uid}/todos, users/{uid}/memos (실시간 동기화 + 오프라인 캐시)
// 구글 캘린더: 앱(window.TodoApp)이 휴대폰 캘린더(구글 계정)에 등록. 웹에서 만든 일정은 앱이 열릴 때 등록된다.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, connectAuthEmulator, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { initializeFirestore, connectFirestoreEmulator, memoryLocalCache, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot,
  setDoc, updateDoc, deleteDoc, deleteField } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const fbApp = initializeApp({
  apiKey: 'AIzaSyBEzeXqVxzFStT5M_y_yF1TG1Mv-JMcZg0',
  authDomain: 'my-todo-memo.firebaseapp.com',
  projectId: 'my-todo-memo',
  storageBucket: 'my-todo-memo.firebasestorage.app',
  messagingSenderId: '56944721674',
  appId: '1:56944721674:web:79ad5b68b60fb987b144f3',
});
const EMU = location.hostname === 'localhost' || location.hostname === '127.0.0.1';   // 로컬 시험: firebase emulators
const auth = getAuth(fbApp);
const db = initializeFirestore(fbApp, { localCache: EMU ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
if (EMU) { connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); connectFirestoreEmulator(db, '127.0.0.1', 8080); }

const A = window.TodoApp || null;           // 안드로이드 앱 안이면 있음
if (A) document.body.classList.add('in-app');
const $ = (s) => document.getElementById(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

let user = null, todos = [], memos = [], unsub = [];
let tab = LS.get('tab', 'todo');

// ---------- 날짜 ----------
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
function dueEnd(t) {                         // 이 시각이 지나면 자동 완료
  const d = parseDate(t.date);
  if (t.time) { const [h, mi] = t.time.split(':').map(Number); d.setHours(h, mi, 0, 0); return d; }
  d.setDate(d.getDate() + 1); return d;      // 날짜만: 그날이 끝나면
}
const sortKey = (t) => { const d = parseDate(t.date); if (t.time) { const [h, mi] = t.time.split(':').map(Number); d.setHours(h, mi); } return d.getTime(); };
function fmtTime(hm) { const [h, m] = hm.split(':').map(Number); return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${pad(m)}`; }
function fmtDue(t) {
  const d = parseDate(t.date);
  const y = d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}년 ` : '';
  return `${y}${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})` + (t.time ? ' ' + fmtTime(t.time) : '');
}
function dday(t) {
  const diff = Math.round((parseDate(t.date) - parseDate(todayStr())) / 86400000);
  if (diff === 0) return { txt: '오늘', cls: 'today' };
  if (diff === 1) return { txt: '내일', cls: 'soon' };
  if (diff < 0) return { txt: '지남', cls: 'today' };
  return { txt: `D-${diff}`, cls: diff <= 3 ? 'soon' : '' };
}
function fmtStamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- 로그인 ----------
$('btnLogin').onclick = async () => {
  $('loginMsg').textContent = '';
  if (A) { A.login(); $('loginMsg').textContent = '브라우저에서 로그인한 뒤 「앱으로 돌아가기」를 누르세요.'; return; }
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { $('loginMsg').textContent = '로그인 실패: ' + (e.code || e.message); }
};
// 앱: 크롬에서 받은 구글 ID 토큰으로 로그인 (app-login.html → todomemo://login)
window.appLogin = async (idToken) => {
  try { await signInWithCredential(auth, GoogleAuthProvider.credential(idToken)); }
  catch (e) { $('loginMsg').textContent = '로그인 실패: ' + (e.code || e.message); }
};
$('btnLogout').onclick = async () => { if (confirm('로그아웃할까요?')) { closeSheets(); await signOut(auth); } };

onAuthStateChanged(auth, (u) => {
  unsub.forEach((f) => f()); unsub = [];
  user = u;
  $('login').hidden = !!u; $('main').hidden = !u;
  if (!u) { todos = []; memos = []; return; }
  $('who').textContent = `${u.displayName || ''} (${u.email})`;
  const base = ['users', u.uid];
  unsub.push(onSnapshot(collection(db, ...base, 'todos'), { includeMetadataChanges: true }, (snap) => {
    todos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    $('syncState').textContent = snap.metadata.hasPendingWrites ? '저장 중…' : snap.metadata.fromCache ? '오프라인' : '';
    autoComplete(); render(); calReconcile();
  }, (e) => toast('불러오기 실패: ' + e.code)));
  unsub.push(onSnapshot(collection(db, ...base, 'memos'), (snap) => {
    memos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }));
});
const todoRef = (id) => doc(db, 'users', user.uid, 'todos', id);
const memoRef = (id) => doc(db, 'users', user.uid, 'memos', id);
const newId = () => doc(collection(db, 'users', user.uid, 'todos')).id;

// ---------- 자동 완료 ----------
function autoComplete() {
  if (!user) return;
  const now = Date.now();
  for (const t of todos) {
    if (t.kind === 'deadline' && !t.done && !t.deleted && t.date && dueEnd(t).getTime() <= now) {
      t.done = true;   // 화면 바로 반영(중복 쓰기 방지)
      updateDoc(todoRef(t.id), { done: true, autoDone: true, doneAt: dueEnd(t).getTime() }).catch(() => {});
    }
  }
}
setInterval(() => { const before = todos.filter((t) => !t.done).length; autoComplete(); if (todos.filter((t) => !t.done).length !== before) render(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { autoComplete(); render(); calReconcile(); } });

// ---------- 화면 그리기 (목록만 다시 그림 — 편집 시트는 건드리지 않음) ----------
function calChip(t) {
  if (t.kind !== 'deadline') return '';
  return t.cal && t.cal.eventId && t.cal.rev === (t.rev || 0)
    ? '<span class="chip cal-ok">📅 캘린더 등록됨</span>'
    : `<span class="chip cal-wait">📅 ${A ? '캘린더 등록 대기' : '앱에서 캘린더 등록 대기'}</span>`;
}
function todoCard(t) {
  const meta = [];
  if (t.kind === 'deadline') {
    const dd = dday(t);
    meta.push(`<span class="chip ${dd.cls}">${dd.txt}</span>`, `<span class="chip">⏰ ${fmtDue(t)}</span>`, calChip(t));
  } else meta.push(`<span class="chip">등록 ${fmtStamp(t.createdAt)}</span>`);
  return `<div class="card" data-id="${t.id}">
    <button class="check" data-act="done" aria-label="완료"></button>
    <div class="body" data-act="open"><div class="t">${esc(t.title)}</div>${t.note ? `<div class="n">${esc(t.note)}</div>` : ''}
    <div class="meta">${meta.join('')}</div></div></div>`;
}
function doneCard(t) {
  const meta = [`<span class="chip">${t.autoDone ? '⏱ 기한 지나 자동 완료' : '✔ 완료'} · ${fmtStamp(t.doneAt || t.createdAt)}</span>`];
  if (t.kind === 'deadline') meta.push(`<span class="chip">⏰ ${fmtDue(t)}</span>`);
  return `<div class="card done" data-id="${t.id}">
    <button class="check" data-act="undo" aria-label="되돌리기">✓</button>
    <div class="body" data-act="open"><div class="t">${esc(t.title)}</div>${t.note ? `<div class="n">${esc(t.note)}</div>` : ''}
    <div class="meta">${meta.join('')}</div></div>
    <div class="side"><button class="mini" data-act="undo">되돌리기</button><button class="mini" data-act="del">삭제</button></div></div>`;
}
function memoCard(m) {
  const edited = m.updatedAt && m.updatedAt - m.createdAt > 60000 ? ` · 수정 ${fmtStamp(m.updatedAt)}` : '';
  return `<div class="card memo-card" data-mid="${m.id}"><div class="body" data-act="memo">
    <div class="t">${esc(m.title || '(제목 없음)')}</div>${m.body ? `<div class="n">${esc(m.body)}</div>` : ''}
    <div class="date">작성 ${fmtStamp(m.createdAt)}${edited}</div></div></div>`;
}
function render() {
  if (!user) return;
  const live = todos.filter((t) => !t.deleted);
  const active = live.filter((t) => !t.done);
  const dl = active.filter((t) => t.kind === 'deadline').sort((a, b) => sortKey(a) - sortKey(b) || a.createdAt - b.createdAt);
  const nm = active.filter((t) => t.kind !== 'deadline').sort((a, b) => a.createdAt - b.createdAt);
  const done = live.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const ms = memos.slice().sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  $('listDeadline').innerHTML = dl.length ? `<div class="group-label">마감 기한 (${dl.length})</div>` + dl.map(todoCard).join('') : '';
  $('listNormal').innerHTML = nm.length ? `<div class="group-label">일반 할 일 (${nm.length})</div>` + nm.map(todoCard).join('') : '';
  $('listDone').innerHTML = done.map(doneCard).join('');
  $('listMemo').innerHTML = ms.map(memoCard).join('');
  $('emptyTodo').hidden = active.length > 0; $('emptyDone').hidden = done.length > 0; $('emptyMemo').hidden = ms.length > 0;
  $('cntTodo').textContent = active.length || ''; $('cntMemo').textContent = memos.length || ''; $('cntDone').textContent = done.length || '';
}
function setTab(t) {
  tab = t; LS.set('tab', t);
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== 'view-' + t));
  $('fab').hidden = t === 'done';
}
document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
setTab(tab);

document.querySelector('main').addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const card = el.closest('.card');
  const t = card && todos.find((x) => x.id === card.dataset.id);
  const m = card && memos.find((x) => x.id === card.dataset.mid);
  switch (el.dataset.act) {
    case 'done': completeTodo(t); break;
    case 'undo': restoreTodo(t); break;
    case 'del': deleteTodo(t); break;
    case 'open': openTodo(t); break;
    case 'memo': openMemo(m); break;
  }
});
$('fab').onclick = () => (tab === 'memo' ? openMemo(null) : openTodo(null));

// ---------- 할 일 동작 ----------
function completeTodo(t) {
  if (!t) return;
  updateDoc(todoRef(t.id), { done: true, autoDone: false, doneAt: Date.now() });
  toast(`「${t.title}」 완료`, '되돌리기', () => updateDoc(todoRef(t.id), { done: false, autoDone: deleteField(), doneAt: deleteField() }));
}
function restoreTodo(t) {
  if (!t) return;
  if (t.kind === 'deadline' && dueEnd(t).getTime() <= Date.now()) { openTodo(t, true); return; }
  updateDoc(todoRef(t.id), { done: false, autoDone: deleteField(), doneAt: deleteField() });
  toast('할 일 목록으로 되돌렸어요');
}
async function deleteTodo(t) {
  if (!t) return;
  const hasEv = t.cal && t.cal.eventId;
  if (!confirm(`「${t.title}」을(를) 삭제할까요?` + (hasEv ? '\n구글 캘린더 일정도 함께 지워져요.' : ''))) return false;
  if (hasEv) await updateDoc(todoRef(t.id), { deleted: true });   // 캘린더 일정은 앱이 지운 뒤 문서를 삭제
  else await deleteDoc(todoRef(t.id));
  calReconcile();
  return true;
}

// ---------- 시트 공통 ----------
let openSheet = null;
function showSheet(id) { closeSheets(); $(id).hidden = false; openSheet = id; }
function closeSheets() { document.querySelectorAll('.sheet').forEach((s) => (s.hidden = true)); openSheet = null; }
function isDirty() {
  if (openSheet === 'sheetTodo') return JSON.stringify(readTodoForm()) !== todoSnap;
  if (openSheet === 'sheetMemo') return $('mTitle').value + '\u0000' + $('mBody').value !== memoSnap;
  return false;
}
function tryClose() { if (isDirty() && !confirm('저장하지 않고 닫을까요?')) return; closeSheets(); }
document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = tryClose));
document.querySelectorAll('.sheet').forEach((s) => s.addEventListener('click', (e) => { if (e.target === s) tryClose(); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openSheet) tryClose(); });
window.appBack = () => { if (openSheet) { tryClose(); return true; } if (tab !== 'todo') { setTab('todo'); return true; } return false; };

// ---------- 할 일 편집 ----------
let editTodo = null, todoSnap = '', kind = 'normal';
function setKind(k) {
  kind = k;
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.kind === k));
  $('deadlineBox').hidden = k !== 'deadline';
}
document.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => { setKind(b.dataset.kind); if (b.dataset.kind === 'deadline' && !$('tDate').value) $('tDate').value = todayStr(); }));
$('tUseTime').onchange = () => { $('tTime').hidden = !$('tUseTime').checked; if ($('tUseTime').checked && !$('tTime').value) $('tTime').value = '09:00'; };
function readTodoForm() {
  return { title: $('tTitle').value.trim(), note: $('tNote').value, kind,
    date: kind === 'deadline' ? $('tDate').value : '', time: kind === 'deadline' && $('tUseTime').checked ? $('tTime').value : '' };
}
function openTodo(t, restoring = false) {
  editTodo = t || null;
  $('todoSheetTitle').textContent = t ? (restoring ? '기한 다시 정하기' : '할 일 수정') : '할 일 추가';
  $('tTitle').value = t ? t.title : '';
  $('tNote').value = t ? t.note || '' : '';
  setKind(t ? t.kind : 'normal');
  $('tDate').value = t && t.date ? t.date : todayStr();
  $('tUseTime').checked = !!(t && t.time); $('tTime').value = t && t.time ? t.time : '09:00'; $('tTime').hidden = !$('tUseTime').checked;
  $('todoActions').hidden = !t;
  $('todoDone').hidden = !t || t.done;
  const info = [];
  if (t) info.push('등록 ' + fmtStamp(t.createdAt));
  if (t && t.done) info.push(t.autoDone ? '기한이 지나 자동 완료됨' : '완료됨 ' + fmtStamp(t.doneAt));
  if (restoring) info.push('기한이 이미 지났어요. 새 날짜로 저장하면 다시 할 일 목록에 올라가요.');
  $('tInfo').textContent = info.join(' · ');
  $('calNote').textContent = A ? '이 휴대폰의 구글 캘린더에도 일정으로 등록돼요. 기한이 지나면 자동으로 완료 처리돼요.'
    : '구글 캘린더 등록은 휴대폰 앱이 열릴 때 이루어져요. 기한이 지나면 자동으로 완료 처리돼요.';
  todoSnap = JSON.stringify(readTodoForm());
  showSheet('sheetTodo');
  if (!t) setTimeout(() => $('tTitle').focus(), 50);
}
$('todoSave').onclick = async () => {
  const f = readTodoForm();
  if (!f.title) { $('tTitle').focus(); toast('제목을 입력하세요'); return; }
  if (f.kind === 'deadline' && !f.date) { toast('마감 날짜를 고르세요'); return; }
  const t = editTodo;
  const future = f.kind !== 'deadline' || dueEnd(f).getTime() > Date.now();
  if (f.kind === 'deadline' && !future && !confirm('이미 지난 기한이에요. 저장하면 바로 완료 처리돼요. 계속할까요?')) return;
  closeSheets();
  if (!t) {
    await setDoc(todoRef(newId()), { ...f, createdAt: Date.now(), done: false, rev: 1 });
    toast('할 일을 추가했어요');
  } else {
    const changed = f.title !== t.title || f.note !== (t.note || '') || f.kind !== t.kind || f.date !== (t.date || '') || f.time !== (t.time || '');
    const up = { ...f };
    if (changed) up.rev = (t.rev || 0) + 1;
    // 다시 정한 기한이 미래면 되살림
    if (t.done && f.kind === 'deadline' && future && (f.date !== t.date || f.time !== (t.time || ''))) Object.assign(up, { done: false, autoDone: deleteField(), doneAt: deleteField() });
    await updateDoc(todoRef(t.id), up);
  }
  calReconcile();
};
$('todoDone').onclick = () => { const t = editTodo; closeSheets(); completeTodo(t); };
$('todoDelete').onclick = async () => { if (await deleteTodo(editTodo) !== false) closeSheets(); };

// ---------- 메모 ----------
let editMemo = null, memoSnap = '';
function openMemo(m) {
  editMemo = m || null;
  $('memoSheetTitle').textContent = m ? '메모' : '새 메모';
  $('mTitle').value = m ? m.title : ''; $('mBody').value = m ? m.body || '' : '';
  $('mInfo').textContent = m ? `작성 ${fmtStamp(m.createdAt)}` + (m.updatedAt && m.updatedAt - m.createdAt > 60000 ? ` · 수정 ${fmtStamp(m.updatedAt)}` : '') : `작성 ${fmtStamp(Date.now())}`;
  $('memoActions').hidden = !m;
  memoSnap = $('mTitle').value + '\u0000' + $('mBody').value;
  showSheet('sheetMemo');
  if (!m) setTimeout(() => $('mTitle').focus(), 50);
}
$('memoSave').onclick = async () => {
  const title = $('mTitle').value.trim(), body = $('mBody').value;
  if (!title && !body.trim()) { toast('내용을 입력하세요'); return; }
  const m = editMemo; closeSheets();
  if (!m) { const now = Date.now(); await setDoc(memoRef(newId()), { title, body, createdAt: now, updatedAt: now }); toast('메모를 저장했어요'); }
  else if (title !== m.title || body !== (m.body || '')) await updateDoc(memoRef(m.id), { title, body, updatedAt: Date.now() });
};
$('memoDelete').onclick = async () => {
  const m = editMemo; if (!m || !confirm(`메모 「${m.title || '(제목 없음)'}」을(를) 삭제할까요?`)) return;
  closeSheets(); await deleteDoc(memoRef(m.id));
};

// ---------- 토스트 ----------
let toastTimer;
function toast(msg, actLabel, act) {
  const el = $('toast');
  el.innerHTML = esc(msg) + (actLabel ? ` <button>${esc(actLabel)}</button>` : '');
  if (actLabel) el.querySelector('button').onclick = () => { el.hidden = true; act(); };
  el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), actLabel ? 5000 : 2500);
}

// ---------- 설정 ----------
$('btnMenu').onclick = () => { showSheet('sheetMenu'); if (A) refreshCalSettings(); };
$('appVer').textContent = A ? '앱 버전 ' + A.version() : '';

// ---------- 구글 캘린더 (앱 전용) ----------
const DEV = (() => { let d = LS.get('devId'); if (!d) { d = Math.random().toString(36).slice(2, 10); LS.set('devId', d); } return d; })();
function calendars() { try { return JSON.parse(A.calendars()); } catch { return []; } }
function calId() {
  let id = LS.get('calId');
  const list = calendars();
  if (id && list.some((c) => String(c.id) === id)) return id;
  const pick = list.find((c) => c.primary && /google/.test(c.type)) || list.find((c) => /google/.test(c.type)) || list[0];
  if (pick) { LS.set('calId', String(pick.id)); return String(pick.id); }
  return null;
}
function refreshCalSettings() {
  const ok = A.calPermission();
  $('btnCalPerm').hidden = ok; $('calSelect').hidden = !ok; $('btnCalSync').hidden = !ok;
  if (!ok) { $('calMsg').textContent = '캘린더 권한이 없어서 일정 등록을 못 하고 있어요.'; return; }
  const list = calendars(), cur = calId();
  $('calSelect').innerHTML = list.map((c) => `<option value="${c.id}" ${String(c.id) === cur ? 'selected' : ''}>${esc(c.name)} — ${esc(c.account)}</option>`).join('');
  $('calMsg').textContent = list.length ? '' : '휴대폰에 쓸 수 있는 캘린더가 없어요. 설정에서 구글 계정 캘린더 동기화를 켜 주세요.';
}
if (A) {
  $('btnCalPerm').onclick = () => A.requestCalendarPermission();
  window.onCalPermission = (ok) => { refreshCalSettings(); if (ok) calReconcile(); else toast('캘린더 권한이 거부됐어요'); };
  $('calSelect').onchange = () => {
    if (!confirm('앞으로 등록할 캘린더를 바꿀까요? 이미 등록된 일정은 원래 캘린더에 남아요.')) { refreshCalSettings(); return; }
    LS.set('calId', $('calSelect').value);
  };
  $('btnCalSync').onclick = () => { calReconcile(true); toast('캘린더를 다시 맞추는 중…'); };
}
let reconciling = false, askedPerm = false;
async function calReconcile(force = false) {
  if (!A || !user || reconciling) return;
  const needWork = todos.some((t) => (t.deleted) || (t.kind === 'deadline' && !(t.cal && t.cal.rev === (t.rev || 0))) || (t.kind !== 'deadline' && t.cal));
  if (!needWork && !force) return;
  if (!A.calPermission()) {
    if (!askedPerm && todos.some((t) => t.kind === 'deadline' && !t.cal)) { askedPerm = true; A.requestCalendarPermission(); }
    // 권한 없어도 삭제 표시된 문서는 정리
    for (const t of todos.filter((x) => x.deleted && !(x.cal && x.cal.dev === DEV))) await deleteDoc(todoRef(t.id)).catch(() => {});
    return;
  }
  const cid = calId();
  reconciling = true;
  try {
    for (const t of todos.slice()) {
      const mine = t.cal && t.cal.eventId && t.cal.dev === DEV;     // 이 휴대폰이 만든 일정만 고침
      if (t.deleted) {
        if (mine) A.calDelete(String(t.cal.eventId));
        await deleteDoc(todoRef(t.id)).catch(() => {});
      } else if (t.kind !== 'deadline') {
        if (t.cal) { if (mine) A.calDelete(String(t.cal.eventId)); await updateDoc(todoRef(t.id), { cal: deleteField() }); }
      } else if (cid && (!t.cal || t.cal.rev !== (t.rev || 0) || (force && mine && !A.calExists(String(t.cal.eventId))))) {
        if (t.cal && !mine && t.cal.eventId) continue;              // 다른 휴대폰이 맡은 일정
        const ev = A.calUpsert(mine ? String(t.cal.calId) : cid, mine ? String(t.cal.eventId) : '', t.title,
          (t.note ? t.note + '\n\n' : '') + '— 할일 메모 앱에서 등록', t.date, t.time || '');
        if (ev) await updateDoc(todoRef(t.id), { cal: { eventId: ev, calId: mine ? t.cal.calId : cid, rev: t.rev || 0, dev: DEV, at: Date.now() } });
      }
    }
  } finally { reconciling = false; }
  if (force) toast('캘린더와 맞췄어요');
}

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
