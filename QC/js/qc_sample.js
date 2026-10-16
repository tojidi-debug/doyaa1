/* [품감] 개별선정(개발) — qc_sample.html (2026-10-14, 개발서버 전용)
 *
 * 이미 있는 기능을 가져다 쓴다(새로 만들지 않는다):
 *   회사 찾기·결산일자        GET /finstmt/companies            ([심사조서Down])
 *   감사보고서 발행 이력      GET /finstmt/dart/report-versions ([안건]·[심사조서Down])
 *   인뎁스 조서 채우기        ar_format.fill_workbook           ([심사조서Down]) — /qc-sample/indepth 가 서식만 갈아 끼움
 *   매출장 대사(독립성)       /independence_check.html          ([품감] 독립성 대사) — 탭에 그대로 띄움
 * 이 화면의 몫은 사전제출자료를 슬라이서로 거르는 것과, 제출자료끼리 맞춰 보는 것뿐이다.
 */
import './ui/guard.js';
import { api, auth } from './api.js';
import { showAlert, showAsk, showChoice, showConfirm, showDetail, showPrompt } from './ui/dialog.js';
import { $, esc, toast } from './lookup_kit.js';
import {
  slicerChoices, defaultSlicers, valueOf, slicerValues, filterRows,
  searchTerm, pickCompany, pickPeriod, LEVELS, issuesTsv,
  isConsolidated, completeness, selectionTable, chipLines,
  scheduleWindow, weekdays, weekCells, firmMatch, inRegister, registerIndex, registerLookup,
  ROW3_ROLES, monthWindow, eventMonths, displayName, topCompanies, workpaperDates, shortTitle, flagBadges,
  topCompanyList, shortName, nameKey, firmBrief, searchTerms, lastReview, unifyMarks, periodMonths, calendarWeeks, historyLine,
  assignCompanyIds, countCompanies, slicerMenu, sheetText, SHEET_NAMES, shortAddr, makeZip, industryGroup, companyKey,
} from './qc_sample_data.js';

const state = {
  me: null, admin: false,
  data: null, file: null,              // ① 개별 선정에 올린 사전제출자료
  slicers: [], picked: {},             // 펼친 슬라이서 id 들 · id → Set(값)
  chosen: new Map(),                   // 행 번호 → 카드 상태
  recon: { files: [], hidden: new Set(), last: null, view: 'item' },
  sched: null, firmFocus: [], rowsOnly: null,   // 품감 일정 · 찾은 회계법인 · 보일 사람(찾기 결과, null 이면 모두)
  reg: null, regKind: '',             // 명부(직전개별선정·차기수임신고) — 지금 회계법인 몫
};

/* ── 공통 ── */

function describe(detail, status) {
  if (status === 401) return '로그인 시간이 지났습니다 — 포털에서 다시 로그인한 뒤 이 화면을 새로고침해 주세요.';
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && detail.message) return detail.message;
  if (Array.isArray(detail) && detail.length) return detail.map((d) => d.msg).filter(Boolean).join(' · ');
  return `처리하지 못했습니다. (서버 응답 ${status})`;
}

/* 액세스 토큰(30분)이 끝났으면 리프레시 한 번 하고 다시 — api.js 와 같게(사용자 질문 2026-10-15: 「로그인이 필요합니다」).
   동시에 여러 요청이 401 이어도 리프레시는 한 번만. */
let refreshing = null;
async function call(url, options = {}) {
  if (api.fetchRaw) return api.fetchRaw(url, options);   // GitHub(정적) 사이트 — 서버 대신 브라우저 파이썬·중계(qc/static/api.js)
  let res = await fetch(url, { credentials: 'same-origin', ...options });
  if (res.status === 401) {
    refreshing = refreshing || fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'same-origin' }).finally(() => { setTimeout(() => { refreshing = null; }, 0); });
    const r = await refreshing;
    if (r.ok) res = await fetch(url, { credentials: 'same-origin', ...options });
  }
  if (!res.ok) {
    let detail = null;
    try { detail = (await res.json()).detail; } catch { /* JSON 아님 */ }
    const err = new Error(describe(detail, res.status));
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return res;
}

async function save(res, fallback) {
  const disp = res.headers.get('Content-Disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(disp);
  const name = fallback || (m ? decodeURIComponent(m[1]) : 'download');
  if (state.zipCollect) {        // 「모두 받기 → zip」 동안은 내려받지 않고 모은다
    state.zipCollect.push({ name, data: new Uint8Array(await res.arrayBuffer()) });
    return name;
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return name;
}

async function busy(button, text, fn) {
  const was = button ? button.textContent : '';
  if (button) { button.disabled = true; button.classList.add('is-busy'); button.textContent = text; }
  try { return await fn(); } finally {
    if (button) { button.disabled = false; button.classList.remove('is-busy'); button.textContent = was; }
  }
}

const roles = () => (state.data && state.data.roles) || {};
const cell = (row, role) => (roles()[role] ? row.values[roles()[role]] : undefined);
const store = {
  get(k) { try { return localStorage.getItem(`qcSample:${k}`) || ''; } catch { return ''; } },
  set(k, v) { try { localStorage.setItem(`qcSample:${k}`, v); } catch { /* 저장 안 돼도 화면은 돈다 */ } },
};

/* ── 탭 ── */

function showTab(name) {
  document.querySelectorAll('.qs-tab').forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  for (const t of ['sched', 'pick', 'recon', 'sales', 'other']) $(`tab-${t}`).hidden = t !== name;
  if (name === 'other') renderOtherList();
  if (name === 'sales') {
    const f = $('salesFrame');
    if (!f.src) f.src = f.dataset.src;     // 3.5MB 화면이라 탭을 처음 열 때만 불러온다
  }
  if (name === 'recon') {
    renderReconList();
    $('firmCheck').hidden = !(state.data || state.recon.last);
    if (!$('firmQ').value) $('firmQ').value = guessFirm();
  }
}

/* ── 서식(상근용·비상근용) ── */

/* 인뎁스 서식 — 위쪽 띠에 두지 않고, 「선정 회사」 줄의 서식 고르기 옆에서 받는다. 교체는 관리자설정 ④(사용자 지정 2026-10-15) */
async function loadTemplates() {
  let list = [];
  try { list = await api.get('/qc-sample/templates'); } catch (e) { $('tplBox').textContent = e.message; return; }
  state.templates = list;
  for (const t of list) {
    const o = $('optKind').querySelector(`option[value="${t.kind}"]`);
    if (o) o.textContent = t.ready ? t.label : `${t.label}(서식 없음)`;
  }
  $('tplBox').innerHTML = '<button class="qs-link" data-tpl-get type="button" title="고른 서식의 빈 파일을 받습니다">빈 서식</button>';
  if (state.adminMode) renderAdmin();
}

async function getBlankTemplate() {
  const kind = $('optKind').value;
  const t = (state.templates || []).find((x) => x.kind === kind);
  if (t && !t.ready) { showAlert(`${t.label} 서식이 아직 없습니다 — 관리자설정에서 올려 주세요.`, { title: '서식' }); return; }
  try { await save(await call(`/api/v1/qc-sample/templates/${kind}`)); } catch (e) { showAlert(e.message, { title: '서식' }); }
}

async function putTemplate(inp) {
  const f = inp.files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append('file', f);
  try {
    await api.upload(`/qc-sample/templates/${inp.dataset.tplPut}`, fd);
    toast('서식을 바꿨습니다.');
    await loadTemplates();
  } catch (e) { showAlert(e.message, { title: '서식 교체' }); }
  inp.value = '';
}

/* ── ① 사전제출자료 → 슬라이서 ── */

async function loadPresubmit(file) {
  $('pickName').textContent = `${file.name} 읽는 중…`;
  const fd = new FormData();
  fd.append('file', file);
  try {
    state.data = await api.upload('/qc-sample/parse', fd);
    unifyMarks(state.data);      // 같은 뜻 다른 표기(Y·○·해당 / -·N/A·해당없음 …)는 한 값으로
    assignCompanyIds(state.data);   // 기별로 여러 줄인 회사도 1개사(법인·사업자등록번호가 같으면 같은 회사)
  } catch (e) {
    $('pickName').textContent = file.name;
    showAlert(e.message, { title: '사전제출자료' });
    return;
  }
  state.file = file;
  // 다른 회계법인 파일이면 그 법인으로 — 파일 이름에서 못 짐작하면, 처음 올릴 때 적어 둔 이름은 두고 다른 파일로 바꿀 때는 비운다
  $('firmName').value = guessFirmFrom(file.name) || (state.shownFile && state.shownFile !== file.name ? '' : $('firmName').value);
  state.shownFile = file.name;
  await showPresubmit(file.name, { fresh: true, file });
  recentSave(file.name);
}

/* 읽은 사전제출자료를 화면에 — 새로 올렸을 때(fresh)만 중요 체크포인트 알림창. 최근 자료를 다시 열 때는 바로 표시만. */
async function showPresubmit(fileName, { fresh = false, file = null } = {}) {
  state.restoring = true;           // 되살리기 전에는 자동 저장을 하지 않는다(빈 선택으로 덮어쓰지 않게)
  state.chosen.clear();
  state.picked = {};
  const d = state.data;
  const yearSlicer = d.roles.year ? `col:${d.roles.year}` : '';
  if (yearSlicer && d.rows.some((r) => String(r.values[d.roles.year] || '').startsWith('당기'))) {
    state.picked[yearSlicer] = new Set(d.rows.map((r) => String(r.values[d.roles.year] || '')).filter((v) => v.startsWith('당기')));
  }
  state.slicers = defaultSlicers(d);
  const extra = Object.keys(d.others || {}).length ? ` · 함께 읽은 시트: ${Object.values(d.others).map((o) => o.sheet).join(', ')}` : '';
  $('pickName').innerHTML = `<b>${esc(fileName)}</b> · 「${esc(d.sheet)}」${esc(extra)}`;     // 행·열 개수는 적지 않는다(사용자 지정 2026-10-15)
  state.pickFileInfo = $('pickName').innerHTML;
  const warn = [...(d.warnings || [])];
  $('pickWarn').hidden = !warn.length;
  $('pickWarn').innerHTML = warn.map(esc).join('<br>');
  // 중요한 체크포인트는 띠 대신 간단한 알림창으로 한 번(사용자 지정 2026-10-14)
  const c = (d.checks && d.checks.summary) || { 위반의심: 0, 중점확인: 0 };
  // 회계기간이 12개월이 아닌 회사(참고, 사용자 지정 2026-10-15) — 단위가 여럿이어도 세 곳 이하면 한 줄, 넘으면 단위별 줄
  const byUnit = new Map(), seenCo = new Set();
  for (const r of d.rows) {
    const m = periodMonths(r, d.rows, d.roles), n = r.values[d.roles.company], k = nameKey(n);
    if (!m || !k || seenCo.has(k)) continue;
    seenCo.add(k);
    byUnit.set(m, [...(byUnit.get(m) || []), n]);
  }
  const periodLines = [];
  if (seenCo.size) {
    const units = [...byUnit.keys()].sort((a, b) => a - b);
    const mk = (title, names, suffix) => {
      const items = names.map((n) => ({ company: n, detail: `${suffix[n] || ''} — 회계기간이 12개월이 아님` }));
      const top = topCompanyList(names, d, 3);
      return { title, people: false, top, items, names: top.all, suffix: units.length > 1 ? Object.fromEntries(names.map((n) => [n, `(${suffix[n]})`])) : {}, full: '' };
    };
    const unitOf = Object.fromEntries(units.flatMap((u) => byUnit.get(u).map((n) => [n, `${u}개월단위`])));
    if (units.length === 1 || seenCo.size <= 3) {
      periodLines.push(mk(units.length === 1 ? `${units[0]}개월단위 결산 ${seenCo.size}개사` : `12개월 아닌 회계기간 ${seenCo.size}개사`,
        units.flatMap((u) => byUnit.get(u)), unitOf));
    } else {
      units.forEach((u) => periodLines.push({ ...mk(`${u}개월단위 결산 ${byUnit.get(u).length}개사`, byUnit.get(u), unitOf), suffix: {} }));
    }
  }
  if (fresh && (c['위반의심'] || c['중점확인'] || periodLines.length)) {
    const top = ((d.checks && d.checks.items) || []).filter((i) => i.level === '위반의심' || i.level === '중점확인');
    const kinds = new Map();
    top.forEach((i) => { const k = kinds.get(i.title) || []; k.push(i); kinds.set(i.title, k); });
    // 한 줄에 「구분(굵게) ○건 : 회사A, 회사B 등」 — 대표 회사는 자산총계(같으면 당기순이익) 큰 순, 줄에 들어가는 만큼(최대 3개사)
    const lines = [...kinds.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6).map(([t, list]) => {
      const title = `${shortTitle(t)} ${list.length}건`;
      const people = list.every((i) => Array.isArray(i.pair));      // 교차심리는 이사 이름 + 그 이사가 맡은 회사
      // 최소 3개사(3개사 이하면 전부) — 한 줄 글자 수로 줄이지 않는다(사용자 지정 2026-10-15)
      const top = people ? null : topCompanyList(list.map((i) => i.company), d, 3);
      return { title, people, top, items: list, names: people ? list.map((i) => i.company) : top.all,
        full: `${t} ${list.length}건 : ${list.map((i) => displayName(i.company)).join(', ')}` };
    }).concat(periodLines);
    setTimeout(() => {
      showDetail({
        title: '중요 체크포인트', badge: `위반의심 ${c['위반의심']} · 중점확인 ${c['중점확인']}`, wide: true,
        body: lines.map((l) => `· ${l.title}`).join('\n'),
        actions: [{ label: '제출자료 대사 보기', value: 'go' }],
      }).then((v) => { if (v === 'go') showTab('recon'); });
      // 공용 알림창은 본문을 글자로만 넣는다 — 이 알림창의 본문만 바꾼다:
      //   구분 항목 굵게 · 한 줄 · 회사명을 누르면 감사보고서(DART) · 「개별회사로 선정」으로 체크해 선정 목록에 넣기(사용자 지정 2026-10-15)
      const body = [...document.querySelectorAll('.kd-mask .kd-body')].pop();
      if (!body) return;
      const co = (n) => `<a class="cp-co" href="#" data-co="${esc(n)}" title="${esc(`${displayName(n)} — ${reportTip(n)}`)}">${esc(shortName(n))}</a>`;
      const open = new Set();          // 펼친 줄(항목 이름·「등」을 누르면 전체 명단과 내용) — 비감사용역 묶음은 「줄:묶음」
      const draw = (picking) => {
        body.innerHTML = `<div class="cp-tools"><button type="button" class="qs-btn" data-cp="pick">${picking ? '접기' : '개별회사로 선정'}</button>${
          picking ? '<button type="button" class="qs-btn qs-primary" data-cp="add">선정에 추가</button><span class="qs-muted">체크한 회사가 「개별 선정」 탭의 선정 회사로 들어갑니다</span>' : ''}</div>`
          + lines.map((l) => {
            if (l.items.every((it) => Array.isArray(it.nas))) return nasLines(l, lines.indexOf(l), co, open);
            if (l.people) {
              // 「김승용(A, B, C 등 12개사) ↔ 신용직(갑)」 — 3개사 넘으면 줄이고 「등」을 누르면 전체(사용자 지정 2026-10-15)
              const i = lines.indexOf(l);
              const side = (x) => {
                if (open.has(i) || x.companies.length <= 3) return `${esc(x.partner)}(${x.companies.map(co).join(', ')})`;
                const t = topCompanyList(x.companies, d, 3);
                return `${esc(x.partner)}(${t.shown.map(co).join(', ')} <a href="#" class="cp-more" data-x="${i}">등 ${x.companies.length}개사 ▼</a>)`;
              };
              const fold = open.has(i) && l.items.some((it) => it.pair.some((x) => x.companies.length > 3)) ? ` <a href="#" class="cp-more" data-x="${i}">▲</a>` : '';
              return `<div class="cp-line${open.has(i) ? ' cp-wrap' : ''}">· <b class="cp-x" data-x="${i}">${esc(sheetText(l.title))}</b> : ${l.items.map((it) => it.pair.map(side).join(' ↔ ')).join(' · ')}${fold}</div>`;
            }
            if (picking) {
              return `<div class="cp-line cp-wrap">· <b>${esc(sheetText(l.title))}</b> : ${l.names.map((n) => `<label class="cp-pick"><input type="checkbox" data-pick="${esc(n)}">${co(n)}</label>`).join(' ')}</div>`;
            }
            const i = lines.indexOf(l);
            const detail = open.has(i) ? `<div class="cp-detail">${l.items.map((it) =>
              `<div>${co(it.company)} — ${esc(it.detail || '')}</div>`).join('')}</div>` : '';
            return `<div class="cp-line">· <b class="cp-x" data-x="${i}" title="눌러서 전체 명단 ${open.has(i) ? '접기' : '보기'}">${esc(sheetText(l.title))}</b> : ${
              l.top.shown.map((n) => co(n) + esc((l.suffix || {})[n] || '')).join(', ')}${l.top.more ? ` <a href="#" class="cp-more" data-x="${i}">등 ${l.top.all.length}개사 ${open.has(i) ? '▲' : '▼'}</a>` : ''}</div>${detail}`;
          }).join('');
      };
      draw(false);
      body.addEventListener('click', (e) => {
        const a = e.target.closest('[data-co]');
        if (a) { e.preventDefault(); openReportByName(a.dataset.co); return; }
        const x = e.target.closest('[data-x]');
        if (x) {
          e.preventDefault();
          const i = /^\d+$/.test(x.dataset.x) ? Number(x.dataset.x) : x.dataset.x;
          if (open.has(i)) open.delete(i); else open.add(i);
          draw(!!body.querySelector('[data-pick]'));
          return;
        }
        const t = e.target.closest('[data-cp]');
        if (!t) return;
        if (t.dataset.cp === 'pick') draw(!body.querySelector('[data-pick]'));
        if (t.dataset.cp === 'add') {
          const names = [...new Set([...body.querySelectorAll('[data-pick]:checked')].map((x) => x.dataset.pick))];
          const n = addChosenByNames(names);
          toast(n ? `${n}개사를 선정 회사에 넣었습니다.` : '체크한 회사가 없습니다(또는 이미 선정됨).');
        }
      });
    }, 50);
  }
  $('slicerArea').hidden = $('resultArea').hidden = false;
  if (file && !state.recon.files.some((f) => f === file)) state.recon.files.unshift(file);
  state.recon.last = { result: d, files: [{ name: fileName, kind: '엑셀', found: [d.sheet, ...Object.values(d.others || {}).map((o) => o.sheet)] }] };
  if (!$('firmName').value.trim()) $('firmName').value = guessFirmFrom(fileName);
  await loadRegisters();
  showFirmBrief();
  renderSlicers();
  renderPicked();
  await restorePicks();          // 이 회계법인에 저장해 둔 선택 내역이 있으면
}

/* 회계법인 감사인감리 한 줄 — 일정·배정 엑셀의 그 회계법인 줄 + DART 사업보고서(본사·분사무소·대표). 파일 정보는 마우스 오버로 */
async function showFirmBrief() {
  const q = $('firmName').value.trim();
  const sc = state.sched;
  const f = sc && sc.ready ? firmMatch(sc.firms, q)[0] : null;
  const box = $('pickName');
  const fileTip = (state.pickFileInfo || '').replace(/<[^>]+>/g, '');
  if (!f) {
    // 파일 정보(이름·행·열·시트)는 줄에 넣지 않고 마우스를 올릴 때만(사용자 지정 2026-10-15)
    box.innerHTML = q ? `<b class="firm-link" title="최근 회계법인사업보고서(DART) 열기">회계법인 ${esc(q)}</b>` : '<span class="qs-muted">대상 회계법인을 파일 이름에서 찾지 못했습니다</span>';
    box.removeAttribute('title');
    box.dataset.file = fileTip;
    return;
  }
  const regular = new Set((sc.staff || []).map((n) => String(n).replace(/\s/g, '')));
  const draw = (dart) => {
    const html = firmBrief(f, regular, dart, sc.firms || []);
    box.innerHTML = html.replace(/^<b>/, '<b class="firm-link" title="최근 회계법인사업보고서(DART) 열기">');
    box.removeAttribute('title');           // 마우스 오버는 깔끔한 안내 창으로(사용자 지정 2026-10-15)
    box.dataset.file = fileTip;
  };
  draw(null);
  const g = await firmGeneral(f);
  if (g && $('firmName').value.trim() === q) draw(g);
}

/* 요약 줄 마우스 오버 — 항목을 한 줄씩 「이름 : 값」으로 보이는 작은 안내 창(사용자 지정 2026-10-15) */
function briefHover() {
  const box = $('pickName');
  let card = document.getElementById('qsHover');
  if (!card) { card = document.createElement('div'); card.id = 'qsHover'; card.className = 'qs-hover'; card.hidden = true; document.body.appendChild(card); }
  box.addEventListener('mouseenter', () => {
    const parts = box.innerHTML.split(/\s+·\s+/).map((x) => x.trim()).filter(Boolean);     // 강조(파랑)를 살리려고 HTML 조각으로
    if (!parts.length) return;
    const [head, ...rest] = parts;
    // 옆으로 넓은 표(사용자 지정 2026-10-15) — 한 줄에 「이름 | 값」 두 쌍, 주소처럼 긴 값은 한 줄 통째로
    const plain = (h) => h.replace(/<[^>]+>/g, '');
    const items = rest.map((x) => {
      const m = /^([^:：<]{1,14})\s*[:：]\s*(.+)$/.exec(x);
      if (m) return [m[1], m[2]];
      return [/^\d{2}\.\d{1,2}\.\d{1,2}/.test(plain(x)) ? '감리 일정' : /선정/.test(x) ? '개별 선정' : '', x];
    });
    const trs = [];
    let pair = [];
    const cellOf = ([k, v]) => `<th>${esc(k)}</th><td>${v}</td>`;      // 값은 요약 줄의 HTML 그대로(강조 유지)
    const flush = () => { if (pair.length) trs.push(`<tr>${pair.map(cellOf).join('')}${pair.length === 1 ? '<th></th><td></td>' : ''}</tr>`); pair = []; };
    for (const it of items) {
      if (plain(String(it[1])).length > 26) { flush(); trs.push(`<tr><th>${esc(it[0])}</th><td colspan="3">${it[1]}</td></tr>`); continue; }
      pair.push(it);
      if (pair.length === 2) flush();
    }
    flush();
    card.innerHTML = `<div class="qs-hover-h">${plain(head)}</div>${trs.length ? `<table>${trs.join('')}</table>` : ''}${
      box.dataset.file ? `<div class="qs-hover-f" title="${esc(box.dataset.file)}">${esc(box.dataset.file)}</div>` : ''}`;
    card.hidden = false;
    const r = box.getBoundingClientRect();
    const w = Math.min(820, window.innerWidth - 24);
    card.style.width = `${w}px`;
    card.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + window.scrollX}px`;
    card.style.top = `${r.bottom + 6 + window.scrollY}px`;
  });
  box.addEventListener('mouseleave', () => { card.hidden = true; });
}

/* DART 회계법인사업보고서의 일반현황(본사·분사무소·대표) — [품감] 법인 조회 /qc API, 법인마다 한 번만 */
/* 보고서 목록은 사업연도(결산기) 최신순, 같은 결산기면 나중에 낸 것(정정본) 먼저 — 맨 앞이 「최근 발행 사업연도의 최신 보고서」.
   예전 사업연도 보고서를 나중에 정정해도 그것이 아니라 가장 최근 사업연도 보고서(사용자 지정 2026-10-15). */
function firmDart(f) {
  state.firmDart = state.firmDart || {};
  const key = f.short || f.firm;
  if (!(key in state.firmDart)) {
    state.firmDart[key] = (async () => {
      try {
        const firms = await api.get(`/qc/firms?q=${encodeURIComponent(key)}`);
        const hit = (firms.items || [])[0];
        if (!hit) return null;
        const reps = await api.get(`/qc/firms/${hit.corp_code}/reports`);
        const latest = (reps.items || [])[0];
        if (!latest) return null;
        let general = null;
        try { general = (await api.get(`/qc/reports/${latest.rcept_no}/profile?corp_code=${hit.corp_code}`)).general || null; } catch { /* 일반현황 없이도 링크는 */ }
        return { general, report: latest };
      } catch { return null; }      // DART 를 못 읽어도 일정·배정 엑셀 값은 보인다
    })();
  }
  return state.firmDart[key];
}
async function firmGeneral(f) { const d = await firmDart(f); return d ? d.general : null; }

/* 요약 줄의 회계법인 이름을 누르면 최근 사업연도 회계법인사업보고서(DART) */
async function openFirmReport() {
  const q = $('firmName').value.trim();
  const sc = state.sched;
  const f = sc && sc.ready ? firmMatch(sc.firms, q)[0] : (q ? { firm: q, short: q } : null);
  if (!f) return;
  const w = window.open('about:blank', '_blank');      // 팝업 막힘을 피하려고 먼저 연다
  const d = await firmDart(f);
  if (d && d.report && d.report.viewer_url) {
    if (w) w.location.href = d.report.viewer_url; else window.open(d.report.viewer_url, '_blank', 'noopener');
  } else {
    if (w) w.close();
    showAlert(`${f.firm} 의 회계법인사업보고서를 DART 에서 찾지 못했습니다.`, { title: '회계법인사업보고서' });
  }
}

/* ── 명부: 직전개별선정회사 · 차기수임신고내역(사용자 지정 2026-10-14) ──
   직전 감사인감리에서 개별대상이었던 회사는 되도록 다시 고르지 않고, 차기에 같은 법인이 수임신고하지 않은 회사는
   이행보고를 받기 어렵다. 고를 때 알리고 표에도 표시한다. */
/* 당기 사업연도 — 제출자료 대사가 감사보고서일로 짐작한 값(없으면 작년) */
const curFy = () => (state.data && state.data.checks && state.data.checks.fy) || new Date().getFullYear() - 1;

async function loadRegisters() {
  try {
    state.reg = await api.get(`/qc-sample/registers?firm=${encodeURIComponent($('firmName').value.trim())}`);
    // 외감수임내역은 연도별 시트가 함께 온다 — 차기 수임신고는 당기+1년 줄만, 당기 줄은 완전성 점검에 쓴다.
    const nx = state.reg.next.items;
    const hasFy = nx.some((i) => i.fy);
    state.reg.nextNext = hasFy ? nx.filter((i) => i.fy === curFy() + 1) : nx;
    state.reg.nextCur = hasFy ? nx.filter((i) => i.fy === curFy()) : [];
    state.regIndex = {
      // 차기 수임을 해약했으면 수임신고가 없는 것과 같다(사용자 확인 2026-10-15)
      prev: registerIndex(state.reg.prev.items), next: registerIndex(state.reg.nextNext.filter((i) => !String(i.cancel || '').trim())),
      review: registerIndex((state.reg.review || {}).items || []), cur: registerIndex(state.reg.nextCur),
      screened: registerIndex((state.reg.screened || {}).items || []),
    };
  } catch { state.reg = null; state.regIndex = null; }
}

function regFlags(row) {
  const r = state.reg, ix = state.regIndex;
  if (!r || !ix) return { prev: false, next: false, review: [], screened: [] };
  const prev = r.prev.items.length > 0 && registerLookup(row, roles(), ix.prev).length > 0;
  const next = r.nextNext.length > 0 && registerLookup(row, roles(), ix.next).length === 0;
  const review = r.review ? registerLookup(row, roles(), ix.review) : [];
  // 직전 심사대상 — 그 회계법인 몫만 받아 오므로(서버가 법인으로 거름) 직전 외감 법인이 같은 경우만 걸린다.
  const screened = r.screened ? registerLookup(row, roles(), ix.screened) : [];
  return { prev, next, review, screened };
}

/* 직전 심사대상 한 줄 — 「2023년 · 혐의감리 발견 X · 법규위반 …」 */
function screenText(list) {
  return list.map((i) => [i.year || (i.fy && `FY${i.fy}`), i.firm, i.finding && `혐의감리 발견 ${i.finding}`, i.violation && `법규위반 ${i.violation}`, i.note]
    .filter(Boolean).join(' · ')).join(' / ');
}

/* 심사·감리 이력 한 줄 — 「FY2024 공개(한영)」 */
function reviewText(list) {
  // 명부의 시트 둘(「3년내 …」·「'15~'19 …」)에 같은 이력이 겹쳐 있다 — 같은 글은 한 번만
  const lines = [...list].sort((a, b) => (b.fy || 0) - (a.fy || 0)).map((i) =>
    `${i.fy ? `FY${i.fy}` : (i.year || '')} ${i.kind || '심사·감리'}${i.firm ? `(${i.firm})` : ''}`.trim());
  return [...new Set(lines)].join(' · ');
}

async function showRegister(kind) {
  await loadRegisters();
  const r = state.reg && state.reg[kind];
  if (!r) { showAlert('명부를 읽지 못했습니다.', { title: '명부' }); return; }
  const firm = $('firmName').value.trim();
  const src = kind === 'next' ? state.reg.nextNext : r.items;
  let list = src.map((i) => `${displayName(i.company)}${i.year ? ` (${i.year})` : ''}${kind === 'screened' && (i.finding || i.violation) ? ` — 혐의감리 ${i.finding || '-'}${i.violation ? ` · ${i.violation}` : ''}` : ''}${i.note ? ` — ${i.note}` : ''}`);
  if (kind === 'review') {
    // 수천 줄이라 다 늘어놓지 않고, 올린 사전제출자료 회사 중 이력이 있는 것만
    const rows = state.data ? state.data.rows.filter((row) => regFlags(row).review.length) : [];
    const seen = new Map();          // 회사마다 한 줄(사전제출자료에 당기·전기 줄이 둘 다 있으면 두 번 걸렸다)
    for (const row of rows) {
      const k = displayName(cell(row, 'company'));
      if (!seen.has(k)) seen.set(k, `${k} — ${reviewText(regFlags(row).review)}`);
    }
    list = [...seen.values()];
  }
  const body = !r.ready ? '아직 명부를 올리지 않았습니다.'
    : kind === 'review' ? (state.data ? (list.length ? list.join('\n') : '올린 사전제출자료의 회사 중 심사·감리 이력이 있는 회사가 없습니다.') : '사전제출자료를 올리면 그 회사들 중 이력이 있는 회사를 보여 드립니다.')
    : !firm ? '위의 「회계법인」 칸에 회계법인 이름을 넣으면 그 법인 몫만 보여 드립니다.'
      : list.length ? list.join('\n') : `명부(${r.total}건)에 「${firm}」 몫이 없습니다.`;
  const v = await showDetail({
    title: `${r.label}${firm ? ` — ${firm}` : ''}`, badge: r.ready ? `${list.length}건` : '',
    meta: r.ready ? [['명부', r.name || ''], ['전체', `${r.total}건 · 회계법인 ${r.firms}곳`], ['올린 날', (r.date || '').slice(0, 10)],
      kind === 'next' ? ['차기', `FY${curFy() + 1} 수임 줄`] : null].filter(Boolean) : [],
    body: body + (state.admin ? '\n\n(명부 올리기·바꾸기는 품감 일정 › 관리자설정에서)' : ''),
  });
  void v;
}

async function uploadRegister(file) {
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await api.upload(`/qc-sample/registers/${state.regKind}?mode=${state.regMode || 'replace'}`, fd);
    toast(res.mode === 'append' ? `자료를 덧붙였습니다 — ${res.added}건 추가 · 모두 ${res.rows}건` : `명부를 올렸습니다 — ${res.rows}건 · 회계법인 ${res.firms}곳`);
    await loadRegisters();
    if (state.data) renderSlicers();
    state.adminRegs = null;
    if (state.adminMode) renderAdmin();
  } catch (e) { showAlert(e.message, { title: '명부 올리기' }); }
}

/* 초기화 — 슬라이서·선택·선정 회사를 처음(올린 직후) 상태로. 올린 파일은 그대로 둔다. */
function resetAll() {
  if (!state.data) return;
  state.chosen.clear();
  state.picked = {};
  const d = state.data;
  const yearId = d.roles.year ? `col:${d.roles.year}` : '';
  if (yearId) {
    const cur = new Set(d.rows.map((r) => String(r.values[d.roles.year] || '')).filter((v) => v.startsWith('당기')));
    if (cur.size) state.picked[yearId] = cur;
  }
  state.slicers = defaultSlicers(d);
  renderSlicers();
  renderPicked();
  toast('처음 상태로 되돌렸습니다.');
}

function renderSlicers() {
  const d = state.data;
  const choices = slicerChoices(d);
  const label = Object.fromEntries(choices.map((c) => [c.id, c.label]));
  const menu = slicerMenu(d, { all: state.slicerAll }).filter((c) => !state.slicers.includes(c.id));
  $('slicerAdd').innerHTML = '<option value="">+ 슬라이서 추가</option>'
    + menu.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')
    + (state.slicerAll ? '<option value="__few">― 자주 쓰는 것만 보기</option>' : '<option value="__all">― 모든 열 보기</option>');
  /* 배치(사용자 지정 2026-10-14): 첫 줄은 사업연도·연결 여부·담당이사·계속감사년수 둘로 고정, 그다음은
     칩이 여러 줄로 넘어가는 슬라이서끼리, 한 줄인 슬라이서끼리 같은 줄에 오게 칩 길이로 묶는다. */
  const pinRoles = ['year', 'partner', 'partner_years', 'firm_years'].map((k) => d.roles[k] && `col:${d.roles[k]}`);
  const pins = ['col:' + (d.roles.year || '-'), '@con_report', ...pinRoles.slice(1)].filter((id) => id && state.slicers.includes(id));
  const row3ids = new Set(ROW3_ROLES.map((k) => d.roles[k] && `col:${d.roles[k]}`).filter(Boolean));
  const rest = state.slicers.filter((id) => !pins.includes(id) && !row3ids.has(id));
  const row3 = state.slicers.filter((id) => row3ids.has(id));
  const lines = Object.fromEntries(rest.map((id) => [id, chipLines(slicerValues(d.rows, id, d.roles, {}).map((v) => v.value))]));
  const row2 = rest.map((id, i) => [id, i]).sort((a, b) => lines[b[0]] - lines[a[0]] || a[1] - b[1]).map(([id]) => id);
  /* 줄 셋(사용자 지정 2026-10-14): ① 사업연도·연결·담당이사·계속감사년수 ② 나머지(한 줄에) ③ 사업본부·대형비상장·감리/조사·1200 */
  const box = (id) => {
    const set = state.picked[id] || new Set();
    // 지금 조건에서 0개인 칩은 감춘다(사용자 지정 2026-10-15: 부적정 0 따위) — 고른 칩과 사업연도는 그대로
    const vals = slicerValues(d.rows, id, d.roles, state.picked).filter((v) => v.count || set.has(v.value) || id === yearId);
    return `<div class="slicer ${set.size ? 'is-active' : ''}" data-id="${esc(id)}">
      <div class="slicer-head"><span title="${esc(label[id] || id)}">${esc(label[id] || id)}</span>
        <button type="button" data-clear title="이 슬라이서 선택 지우기">⨯</button>
        <button type="button" data-close title="슬라이서 닫기">−</button></div>
      <div class="slicer-chips">${vals.map((v) => `<button type="button" class="chip ${set.has(v.value) ? 'on' : (v.count ? '' : 'dim')}"
          data-v="${esc(v.value)}" title="${esc(v.value)} — ${v.count}개사"><span class="chip-v">${esc(v.value)}</span><em>${v.count}</em></button>`).join('')}</div></div>`;
  };
  const cellOf = (x) => (Array.isArray(x)
    ? `<div class="slicer-stack"><div class="slicer-stack-in">${x.map(box).join('')}</div></div>` : box(x));
  const row = (ids) => (ids.length ? `<div class="qs-slicer-row" style="grid-template-columns: repeat(${Math.max(ids.length, 5)}, minmax(0, 1fr))">${ids.map(cellOf).join('')}</div>` : '');
  /* 사업연도·연결 여부는 한 칸에 위아래로(사용자 지정 2026-10-15) — 옆 슬라이서 높이에 맞추고, 빈 자리는 둘째 줄 첫 슬라이서로 채운다 */
  const yearId = 'col:' + (d.roles.year || '-');
  let first = pins;
  if (pins.includes(yearId) && pins.includes('@con_report')) {
    first = [[yearId, '@con_report'], ...pins.filter((id) => id !== yearId && id !== '@con_report')];
    while (first.length < 5 && row2.length) first.push(row2.shift());
  }
  // 셋째 줄은 지금 거른 결과 안에 해당 건수가 있을 때만(모두 0건이면 숨김 — 사용자 지정 2026-10-15). 고른 것이 있으면 남긴다.
  const row3live = row3.filter((id) => (state.picked[id] && state.picked[id].size)
    || slicerValues(d.rows, id, d.roles, state.picked).some((v) => v.count > 0 && v.value !== '(빈 칸)' && yesNoLike(v.value)));
  $('slicers').innerHTML = row(first) + row(row2) + row(row3live);
  renderComplete(label);
  renderHits();
  autoSavePicks();
}

/* 「아니오」류(비해당·해당없음·N …)는 해당 건으로 치지 않는다 */
const yesNoLike = (v) => !/^(n|no|x|부|아니오|아니요|해당없음|해당사항없음|비해당|비대상|미해당|-|n\/a|#n\/a)$/i.test(String(v).replace(/\s/g, ''));

/* 완전성(사용자 지정 2026-10-14) — 사업연도별 행·회사 수, 슬라이서마다 칩 합계 = 행 수, 빈 칸, 연번 빠짐 */
function renderComplete(label) {
  const c = completeness(state.data, state.slicers);
  // 회사 기준 개수만(사용자 지정 2026-10-15) — 행 수·같은 회사 줄·칩 합계 안내는 뺌
  const yrs = c.years.map((y) => `${esc(y.year)} <b>${y.companies}</b>개사`).join(' · ');
  const blanks = c.slicers.filter((x) => x.blank).map((x) => `${esc(label[x.id] || x.id)} ${x.blank}`);
  const notes = [];
  if (blanks.length) notes.push(`빈 칸: ${blanks.join(', ')}`);
  if (c.nos && c.nos.missing.length) notes.push(`<span class="bad">NO 연번 빠짐: ${c.nos.missing.join(', ')}${c.nos.missing.length >= 30 ? ' …' : ''}</span>`);
  // 외감수임내역 ↔ 2-3 당기 — 같은 회사 여러 줄은 하나로, 해약한 회사는 빼고 「해약 N」으로 따로(사용자 확인 2026-10-15)
  const curAll = (state.reg && state.reg.nextCur) || [];
  const coKey = (i) => String(i.biz_no || '').replace(/\D/g, '') || nameKey(i.company);
  const cancelled = [...new Map(curAll.filter((i) => String(i.cancel || '').trim()).map((i) => [coKey(i), i])).values()];
  const cancelKeys = new Set(cancelled.map(coKey));
  const cur = [...new Map(curAll.filter((i) => !cancelKeys.has(coKey(i))).map((i) => [coKey(i), i])).values()];
  if (curAll.length && $('firmName').value.trim()) {
    const yid = state.data.roles.year;
    const mine = state.data.rows.filter((row) => !yid || String(row.values[yid] || '').startsWith('당기'));
    const ix = registerIndex(curAll);        // 해약한 회사가 2-3 에 있어도 「수임내역에 없음」은 아니다
    const notIn = mine.filter((row) => !registerLookup(row, state.data.roles, ix).length);
    const myIx = registerIndex(mine.map((row) => ({ company: row.values[state.data.roles.company], biz_no: row.values[state.data.roles.biz_no] })));
    const missing = cur.filter((i) => !registerLookup({ values: { C: i.company, E: i.biz_no } }, { company: 'C', biz_no: 'E' }, myIx).length);
    const bad = notIn.length || missing.length;
    notes.push(`<span class="${bad ? 'bad' : 'good'}" title="${esc([...missing.map((i) => sheetText(`2-3 에 없음: ${i.company}`)), ...notIn.map((row) => `외감수임내역에 없음: ${row.values[state.data.roles.company]}`),
      ...cancelled.map((i) => `해약(대사에서 뺌): ${i.company} ${String(i.cancel).slice(0, 10)}`)].join('\n'))}">`
      // 0개인 것은 적지 않는다(사용자 지정 2026-10-15)
      + sheetText(`외감수임 FY${curFy()} ${cur.length}${cancelled.length ? `(해약 ${cancelled.length} 제외)` : ''} ↔ 2-3 당기 ${countCompanies(mine, state.data.roles)}${
        bad ? ' — ' + [missing.length ? `2-3 에 없음 ${missing.length}` : '', notIn.length ? `수임내역에 없음 ${notIn.length}` : ''].filter(Boolean).join(' · ') : ' 일치'}`) + '</span>');
  }
  $('completeBox').innerHTML = `<b>완전성</b> ${yrs} · ${notes.join(' · ')}`;
  $('completeBox').title = '마우스를 올린 곳의 목록이 보입니다. 수임내역은 외감수임내역(차기수임 명부)';
}

function onSlicerClick(e) {
  const box = e.target.closest('.slicer');
  if (!box) return;
  const id = box.dataset.id;
  if (e.target.closest('[data-close]')) {
    state.slicers = state.slicers.filter((x) => x !== id);
    delete state.picked[id];
  } else if (e.target.closest('[data-clear]')) {
    delete state.picked[id];
  } else {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const set = state.picked[id] || new Set();
    const v = chip.dataset.v;
    if (set.has(v)) set.delete(v); else set.add(v);
    state.picked[id] = set;
  }
  renderSlicers();
}

/* 해당 회사 표 칸(사용자 지정 2026-10-15) — 사업연도(슬라이서로 고른 대로)·업종(묶음)은 빼고 담당이사 옆에 심리자.
   재무·보수·시간은 전체 회사에, 금액 단위 백만원. 열 머리를 누르면 오름·내림차순. */
const HIT_COLS = [
  ['role', 'company', '회사명'], ['role', 'partner', '담당이사'], ['role', 'reviewer', '심리자'],
  ['mix', 'years', '계속'], ['der', '@first', '초도·지정'],
  ['der', '@gaap', '기준서'], ['der', '@con_report', '연결'],
  ['role', 'industry', '업종'], ['der', '@branch', '소속'], ['der', '@opinion', '감사의견'],
  ['role', 'assets', '자산총액'], ['role', 'net_income', '당기순이익'], ['role', 'audit_fee', '감사보수'],
  ['role', 'total_hours', '감사시간'], ['role', 'report_date', '보고서일'],
];
/* 기준서는 짧게 — 「일반」·「K-IFRS」(소기업 특례면 「일반(특례)」) */
const gaapShort = (v) => (/K-?IFRS|국제/i.test(String(v)) ? 'K-IFRS' : /특례|소기업/.test(String(v)) ? '일반(특례)' : /일반|기업회계/.test(String(v)) ? '일반' : v);
const NUM_COLS = new Set(['years', 'assets', 'net_income', 'audit_fee', 'total_hours']);
/* 칸에 보일 값 — 정렬도 이 값으로 */
function hitValue(r, t, k) {
  const raw = t === 'mix' ? `${cell(r, 'firm_years') ?? '-'}/${cell(r, 'partner_years') ?? '-'}` : t === 'role' ? cell(r, k) : valueOf(r, k, roles());
  if (k === 'company') return shortName(raw);          // PFV·SPC·REIT 줄임(전체 이름은 마우스 오버)
  if (k === '@first') return shortFirst(raw);
  if (k === '@gaap') return gaapShort(raw);
  if (k === '@con_report') return /^연결(\(일자없음\))?$/.test(String(raw)) ? '연결' : '';      // 연결만 표시, 별도는 공란(사용자 지정 2026-10-15)
  if (k === '@branch') return String(raw || '').replace(/^본점·/, '');      // 「본점·여의도」 → 「여의도」(좌우 스크롤 없게)
  return raw;
}
function hitSortKey(r, t, k) {
  if (t === 'mix') return (Number(cell(r, 'firm_years')) || 0) * 1000 + (Number(cell(r, 'partner_years')) || 0);
  const v = hitValue(r, t, k);
  if (NUM_COLS.has(k)) { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null; }
  const s = v === '(빈 칸)' ? '' : String(v ?? '');
  return s || null;
}
/* 초도·지정 칸은 짧게(사용자 지정 2026-10-15) — 「초도」·「지정」만, 계속·자유수임은 비움 */
const shortFirst = (v) => [/^초도/.test(String(v)) ? '초도' : '', /지정/.test(String(v)) ? '지정' : ''].filter(Boolean).join('·');

function hitRows() {
  return filterRows(state.data.rows, state.picked, state.data.roles);
}

/* 회사명 옆 참고 표시(직전선정·차기미신고·N개월단위·대형비상장·감리조사·소규모·직전심사·심사·감리) — 해당 회사 표와 선정 회사 카드에 같게 */
function companyBadges(r) {
  const flags = regFlags(r);
  const months = periodMonths(r, state.data.rows, roles());
  return (flags.prev ? '<span class="badge prev" title="직전 감사인감리 개별대상">직전선정</span>' : '')
    + (flags.next ? '<span class="badge next" title="차기 수임신고 명부에 없음">차기미신고</span>' : '')
    + (months ? `<span class="badge next" title="회계기간이 12개월이 아닌 회사">${months}개월단위</span>` : '')
    + flagBadges(r, roles()).map((b) => `<span class="badge flag-${b.cls}" title="${esc(b.tip || '')}">${esc(b.text)}</span>`).join('')
    + (flags.screened && flags.screened.length ? `<span class="badge screened" title="${esc(screenText(flags.screened))}">직전심사</span>` : '')
    + (flags.review && flags.review.length ? `<span class="badge review" title="${esc(reviewText(flags.review))}">심사·감리 ${esc(String(Math.max(...flags.review.map((i) => i.fy || 0)) || ''))}</span>` : '');
}

function renderHits() {
  const rows = hitRows();
  $('hitCount').textContent = countCompanies(rows, roles());     // 회사 기준(기별 여러 줄은 1개사)
  const cols = HIT_COLS.filter(([t, k]) => t === 'der' || (t === 'mix' ? roles().firm_years || roles().partner_years : roles()[k]));
  // 정렬(사용자 지정 2026-10-15) — 숫자 칸 오른쪽, 회사명 왼쪽, 나머지 가운데
  const align = (k) => (k === 'company' ? 'al-l' : NUM_COLS.has(k) && k !== 'years' ? 'num' : 'al-c');   // 계속(수임/이사)는 가운데
  const so = state.hitSort && cols.find(([, k]) => k === state.hitSort.k);
  if (so) {
    const [t, k] = so, dir = state.hitSort.dir;
    rows.sort((a, b) => {
      const x = hitSortKey(a, t, k), y = hitSortKey(b, t, k);
      if (x === null || y === null) return (x === null) - (y === null);        // 빈 값은 늘 뒤
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko')) * dir;
    });
  }
  const mark = (k) => (state.hitSort && state.hitSort.k === k ? (state.hitSort.dir > 0 ? '▲' : '▼') : '↕');
  const head = `<thead><tr><th class="al-c">선정</th>${cols.map(([, k, l]) => `<th class="${align(k)} sortable${state.hitSort && state.hitSort.k === k ? ' is-sorted' : ''}" data-sort="${esc(k)}" title="눌러서 오름·내림차순">${esc(l)}<span class="sort-mark">${mark(k)}</span></th>`).join('')}</tr></thead>`;
  const body = rows.slice(0, 1000).map((r) => {
    const on = state.chosen.has(r.row);
    return `<tr class="${on ? 'is-picked' : ''}"><td class="al-c"><input type="checkbox" data-row="${r.row}" ${on ? 'checked' : ''} aria-label="선정"></td>${
      cols.map(([t, k]) => {
        // 계속년수는 한 칸에 「수임/이사」(사용자 지정 2026-10-15)
        let v = hitValue(r, t, k);
        if (k === 'report_date' && /^\d{4}-\d{2}-\d{2}/.test(String(v))) v = String(v).slice(2, 10).replace(/-/g, '.');   // 26.03.20
        const num = typeof v === 'number';
        const badge = k === 'company' ? companyBadges(r) : '';
        const why = k === '@opinion' && /한정|부적정|의견거절/.test(String(v))
          ? ` <button class="qs-link" type="button" data-why="${r.row}" title="감사보고서의 「…의견 근거」를 읽어 옵니다">사유</button>` : '';
        // 사업연도 칸은 없앴다 — 전기 줄은 줄 색으로만 구분(슬라이서에서 전기를 함께 고른 경우)
        const yr = k === 'company' && String(cell(r, 'year') || '').startsWith('전기') ? ' yr-prev' : '';
        // 감사보수는 늘 소수 한 자리(사용자 지정 2026-10-15)
        const fmt = (x) => (k === 'audit_fee' ? x.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : x.toLocaleString('ko-KR'));
        const text = esc(num ? fmt(v) : (v === '(빈 칸)' ? '' : v ?? ''));
        // 회사명은 한 줄 — 넘치면 「…」, 표시는 오른쪽에 붙여 잘리지 않게(사용자 지정 2026-10-15)
        // 계속년수 — 「수임 3 / 이사 2」, 수임·이사 글자는 작고 연한 회색(사용자 지정 2026-10-15)
        if (k === 'years') {
          const n = (x) => esc(x ?? '-');
          return `<td class="al-c yrs"><small>수임</small> ${n(cell(r, 'firm_years'))} / <small>이사</small> ${n(cell(r, 'partner_years'))}</td>`;
        }
        if (k === 'company') return `<td class="al-l co-cell${yr}"><div class="co-line"><span class="co-nm" title="${esc(displayName(cell(r, 'company')))}">${text}</span>${badge}</div></td>`;
        // K-IFRS 는 파랑 · 담당이사와 심리자가 같은 사람이면 둘 다 파랑(자기심리, 사용자 지정 2026-10-15)
        const sameRv = (k === 'partner' || k === 'reviewer') && cell(r, 'partner') && cell(r, 'reviewer')
          && String(cell(r, 'partner')).replace(/\s/g, '') === String(cell(r, 'reviewer')).replace(/\s/g, '');
        const blue = (k === '@gaap' && v === 'K-IFRS') || sameRv ? ' t-blue' : '';
        return `<td class="${num ? 'num' : align(k)}${yr}${blue}"${sameRv ? ' title="담당이사가 심리자와 같음(자기심리)"' : ''}>${text}${badge}${why}</td>`;
      }).join('')}</tr>`;
  }).join('');
  $('hitTable').innerHTML = head + `<tbody>${body || `<tr><td colspan="${cols.length + 1}" class="qs-muted">맞는 회사가 없습니다.</td></tr>`}</tbody>`;
}

/* 한정·의견거절 사유 — 그 결산기 감사보고서(DART)의 「…의견 근거」 단락. 결산기는 감사보고서일에서 석 달 앞. */
async function showWhy(button) {
  const row = state.data.rows.find((r) => r.row === Number(button.dataset.why));
  if (!row) return;
  const { year, month } = reportPeriodOf(row);      // 감사보고서 링크와 같은 당기 기준
  const name = searchTerm(cell(row, 'company'));
  let corp = '';
  await busy(button, '읽는 중…', async () => {
    for (;;) {
      const q = new URLSearchParams({ company: name, year: String(year), fiscal_month: String(month), auditor: auditorName() });
      if (corp) q.set('corp_code', corp);
      try {
        const res = await (await call(`/api/v1/qc-sample/opinion-basis?${q}`)).json();
        const tag = res.routine ? '일반적 사유(초도 수임 범위제한 등) — 중요한 특이사항 아님' : '확인 필요';
        await showDetail({
          title: `${res.opinion || cell(row, 'opinion')} 사유 — ${displayName(cell(row, 'company'))}`, badge: tag, wide: true,
          meta: [['보고서', res.report], ['제출일', res.filed_date]].filter((m) => m[1]),
          body: res.text || '감사보고서에서 「의견 근거」 단락을 찾지 못했습니다. 원문을 열어 확인해 주세요.',
          actions: res.url ? [{ label: '공시뷰어 열기', value: 'open' }] : [],
        }).then((v) => { if (v === 'open') window.open(res.url, '_blank', 'noopener'); });
        return;
      } catch (e) {
        if (e.status === 409 && e.detail && Array.isArray(e.detail.candidates)) {
          corp = await showChoice({ title: '어느 회사입니까?', body: e.detail.message,
            options: e.detail.candidates.map((it) => ({ value: it.corp_code, label: `${it.corp_name} (${it.corp_code})`,
              hint: [it.ceo_nm && `대표 ${it.ceo_nm}`, it.adres].filter(Boolean).join(' · ') })) });
          if (corp) continue;
          return;
        }
        await showAlert(e.message, { title: '감사의견 사유' });
        return;
      }
    }
  });
}

function onHitCheck(e) {
  const box = e.target.closest('input[data-row]');
  if (!box) return;
  const rowNo = Number(box.dataset.row);
  if (box.checked) {
    const row = state.data.rows.find((r) => r.row === rowNo);
    state.chosen.set(rowNo, { row, msg: '', err: false, corp: '', basis: pickBasis() });
    resolveCompany(state.chosen.get(rowNo));
    const f = regFlags(row);
    const name = displayName(cell(row, 'company'));
    (async () => {
      if (f.prev) await showAlert('직전 감사인감리에서 개별대상으로 선정된 회사입니다. 확인필요', { title: name });
      if (f.next) await showAlert('차기 수임신고가 되지 아니한 회사입니다. 확인필요', { title: name });
      if (f.screened.length) await showAlert(`직전에 이미 심사대상으로 선정된 회사입니다(같은 회계법인 감사) — ${screenText(f.screened)}. 확인필요`, { title: name });
      if (f.review.length) {
        await showAlert(`심사·감리로 선정된 적이 있는 회사입니다 — ${reviewText(f.review)}.\n최근 1~2년 이내라면 되도록 이번 개별대상으로 선정하지 않는 것이 좋습니다.`, { title: name });
      }
    })();
  } else {
    state.chosen.delete(rowNo);
  }
  renderHits();
  renderPicked();
}

/* ── 선정 회사 카드 ── */

/* 선정현황 표(심의안에 옮겨 쓰는 꼴) — 모집단은 사업연도 슬라이서만 거친 회사(보통 당기 전체) */
function renderStatus() {
  const d = state.data;
  const yearId = d.roles.year ? `col:${d.roles.year}` : '';
  const population = yearId && state.picked[yearId] ? filterRows(d.rows, { [yearId]: state.picked[yearId] }, d.roles) : d.rows;
  const chosen = [...state.chosen.values()].map((c) => c.row);
  const preferred = [...(state.picked['@industry'] || [])];
  // 2-3 업종이 「기타」(또는 빈 칸)인 선정 회사는 사내 재무 DB 업종명(표준산업분류)으로 다시 묶는다 — 같은 회사의 모든 줄(모집단 포함)
  const override = new Map();
  for (const c of state.chosen.values()) {
    const g = industryGroup(cell(c.row, 'industry'));
    const db = c.company && industryGroup(c.company.ind_nm);
    if ((!g || g === '기타') && db && db !== '기타') {
      const k = companyKey(c.row, d.roles);
      for (const r of population) if (companyKey(r, d.roles) === k) override.set(r.row, db);
      override.set(c.row.row, db);
    }
  }
  const t = selectionTable(population, chosen, d.roles, preferred, 2, override);     // 업종 2개 + 기타(보고 양식)
  const tr = (x, cls = '') => `<tr class="${cls}"><td${x.merged && x.merged.length ? ` title="${esc(`기타에 든 업종: ${x.merged.join(', ')}`)}"` : ''}>${esc(x.name)}</td><td class="num">${x.pop || '-'}</td><td class="num">${x.pick || '-'}</td><td class="num">${esc(x.rate)}</td></tr>`;
  $('statusTable').innerHTML = `<thead><tr><th>구 분</th><th>모집단구성수</th><th>표본선정수</th><th>선정률(%)</th></tr></thead>
    <tbody>${t.rows.map((x) => tr(x, x.pick && x.name !== '기타' ? 'is-pref' : '')).join('')}${tr(t.total, 'is-total')}</tbody>`;
  $('statusTable').dataset.tsv = [['구분', '모집단구성수', '표본선정수', '선정률(%)'], ...t.rows.map((x) => [x.name, x.pop || '-', x.pick || '-', x.rate]),
    [t.total.name, t.total.pop, t.total.pick, t.total.rate]].map((r) => r.join('\t')).join('\n');
}

function renderPicked() {
  autoSavePicks();
  const list = [...state.chosen.values()];
  if (state.data) renderStatus();
  $('pickedArea').hidden = !list.length;
  $('pickedCount').textContent = list.length;
  // 가운데에 「최종 4개사 선정 대상」 — 품감 일정의 그 회계법인 개별선정 개수(사용자 지정 2026-10-15)
  const sc = state.sched;
  const ff = sc && sc.ready && $('firmName').value.trim() ? firmMatch(sc.firms, $('firmName').value.trim())[0] : null;
  $('pickedHint').innerHTML = ff && ff.reviews != null && ff.reviews !== '' ? `최종 <b class="pk-n">${esc(ff.reviews)}개사</b> 선정 대상` : '';
  $('pickedList').innerHTML = list.map((c) => {
    const r = c.row;
    const name = displayName(cell(r, 'company'));
    const con = isConsolidated(r, roles());
    const meta = cardInfo(c);
    let db = '<span class="qs-muted">사내 재무 DB 에서 찾는 중…</span>';
    // 사내 재무 DB 회사를 찾았으면 이름은 다시 적지 않고 결산일자 고르기만 회사명 옆에(사용자 지정 2026-10-15)
    const periodSel = c.company ? `<select class="qs-select pk-period" data-period="${r.row}" title="${esc(`결산일자 — 사내 재무 DB: ${c.company.name} (${c.how || '선택'})`)}">${
      (c.company.periods || []).map((p) => `<option value="${p}" ${p === c.baseDt ? 'selected' : ''}>${p.slice(0, 4)}.${p.slice(4, 6)}.${p.slice(6)}</option>`).join('')}</select>` : '';
    if (c.company) {
      db = '';
    } else if (c.candidates && c.candidates.length) {
      db = `같은 회사를 고르세요 <select class="qs-select" data-cand="${r.row}"><option value="">—</option>${c.candidates.slice(0, 30).map((x, i) =>
        `<option value="${i}">${esc(x.name)} · ${esc(x.ceo || '')} · ${esc(x.biz || '')}</option>`).join('')}</select>`;
    } else if (c.searched) {
      db = `<span class="msg err">사내 재무 DB 에서 찾지 못했습니다.</span> <input class="qs-input" data-term="${r.row}" placeholder="다른 이름으로 찾기">`;
    }
    return `<div class="pk" data-row="${r.row}">
      <h3>${esc(name)}${companyBadges(r)} ${periodSel}<span class="qs-grow"></span><button class="qs-link" type="button" data-drop="${r.row}">빼기</button></h3>
      <div class="meta pk-info" title="빨강 = 고를 때 걸려 있던 슬라이서">${meta}</div>
      ${db ? `<div class="db">${db}</div>` : ''}
      <div class="acts">
        <button class="qs-btn qs-primary" type="button" data-act="indepth" ${c.company ? '' : 'disabled'}>인뎁스 조서</button>
        <button class="qs-btn" type="button" data-act="indi" ${c.company ? '' : 'disabled'}>감사보고서 PDF</button>
        <button class="qs-btn" type="button" data-act="link-indi" ${c.company ? '' : 'disabled'} title="DART 공시뷰어에서 그 결산기 최신 감사보고서를 엽니다">보고서DART ↗</button>
        ${con ? `<button class="qs-btn" type="button" data-act="con" ${c.company ? '' : 'disabled'}>감사보고서(연결) PDF</button>
        <button class="qs-btn" type="button" data-act="link-con" ${c.company ? '' : 'disabled'} title="DART 공시뷰어에서 그 결산기 최신 연결감사보고서를 엽니다">연결DART ↗</button>` : ''}
      </div>
      ${c.err && c.msg ? `<div class="msg err">${esc(c.msg)}</div>` : ''}
    </div>`;
  }).join('');
}

async function resolveCompany(c, term) {
  const q = term || searchTerm(cell(c.row, 'company'));
  c.searched = false;
  try {
    if (q.length < 2) throw new Error('회사명이 너무 짧습니다.');
    const res = await api.get(`/finstmt/companies?q=${encodeURIComponent(q)}`);
    // 같은 이름이 여럿이면 이 회계법인이 수임한 회사(외감수임내역의 사업자등록번호)로
    const k = nameKey(cell(c.row, 'company'));
    const reg = ((state.reg && state.reg.nextCur) || []).concat((state.reg && state.reg.nextNext) || []);
    const bizHints = reg.filter((i) => nameKey(i.company) === k).map((i) => i.biz_no);
    const got = pickCompany(res.items || [], c.row, roles(), { bizHints });
    if (got.pick) setCompany(c, got.pick, got.how);
    else c.candidates = got.candidates;
  } catch (e) {
    c.msg = e.message;
    c.err = true;
  }
  c.searched = true;
  renderPicked();
}

function setCompany(c, company, how) {
  c.company = company;
  c.how = how;
  c.candidates = null;
  c.baseDt = pickPeriod(company.periods, c.row, roles());
  c.versions = null;
}

function cardOf(el) {
  const box = el.closest('.pk');
  return box ? state.chosen.get(Number(box.dataset.row)) : null;
}

async function onPickedClick(e) {
  const drop = e.target.closest('[data-drop]');
  if (drop) { state.chosen.delete(Number(drop.dataset.drop)); renderHits(); renderPicked(); return; }
  const pdf = e.target.closest('[data-pdf]');
  if (pdf) { const c = cardOf(pdf); await getPdf(c, pdf.dataset.basis, pdf.dataset.rc, pdf); return; }
  const act = e.target.closest('[data-act]');
  if (!act) return;
  const c = cardOf(act);
  if (!c) return;
  if (act.dataset.act === 'indepth') await getIndepth(c, act);
  else if (act.dataset.act.startsWith('link-')) await openReport(c, act.dataset.act.slice(5), act);
  else await getReport(c, act.dataset.act, act);
}

function onPickedChange(e) {
  const t = e.target;
  const c = cardOf(t);
  if (!c) return;
  if (t.dataset.period) { c.baseDt = t.value; c.versions = null; renderPicked(); }
  if (t.dataset.cand && t.value !== '') { setCompany(c, c.candidates[Number(t.value)], '선택'); renderPicked(); }
  if (t.dataset.term && t.value.trim()) resolveCompany(c, t.value.trim());
}

function opts() {
  return { kind: $('optKind').value, lead: $('optLead').value.trim(), member: $('optMember').value.trim(), schedule: $('optSchedule').value.trim() };
}

async function getIndepth(c, button) {
  const o = opts();
  const rd = String(cell(c.row, 'report_date') || '');
  return busy(button, '만드는 중…', async () => {
    try {
      // 상근용이면 그 결산기 감사보고서(가장 나중 제출본)를 넘겨 요약BS·PL 비고 칸에 분석적 검토 문구를 넣는다(사용자 지정 2026-10-15)
      let rcept = '';
      if (o.kind === 'full') {
        try { const v = await versions(c, 'indi'); rcept = ((v.items || []).slice(-1)[0] || {}).receipt || ''; } catch { /* 문구 없이 */ }
      }
      const res = await call('/api/v1/qc-sample/indepth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: o.kind, nice_id: c.company.nice_id, company_name: c.company.name, base_dt: c.baseDt,
          report_date: /^\d{4}-\d{2}-\d{2}$/.test(rd) ? rd : '',
          consolidated: isConsolidated(c.row, roles()),
          industry: String(cell(c.row, 'industry') || ''), lead: o.lead, member: o.member, schedule: o.schedule,
          rcept_no: /^\d{14}$/.test(rcept) ? rcept : '',
        }),
      });
      const name = await save(res);
      c.msg = `받음: ${name}`; c.err = false;
    } catch (e) { c.msg = e.message; c.err = true; }
    renderPicked();
  });
}

/* 그 결산기 감사보고서의 발행 이력(정정 포함) — 이미 있는 /finstmt/dart/report-versions 를 쓴다. */
async function versions(c, basis) {
  const y = c.baseDt.slice(0, 4), m = Number(c.baseDt.slice(4, 6));
  for (;;) {
    const q = new URLSearchParams({ company: c.company.name, year: y, basis, fiscal_month: String(m), auditor: auditorName() });
    const corp = c.corp || c.company.corp_code;   // 정적 사이트는 회사 찾기부터 전자공시 고유번호다
    if (corp) q.set('corp_code', corp);
    try {
      return await (await call(`/api/v1/finstmt/dart/report-versions?${q}`)).json();
    } catch (e) {
      if (e.status === 409 && e.detail && Array.isArray(e.detail.candidates)) {
        const chosen = await showChoice({
          title: '어느 회사입니까?',
          body: `${e.detail.message}\n전자공시에 같은 이름으로 올라 있는 회사입니다.`,
          options: e.detail.candidates.map((it) => ({ value: it.corp_code, label: `${it.corp_name} (${it.corp_code})`,
            hint: [it.ceo_nm && `대표 ${it.ceo_nm}`, it.acc_mt && `${it.acc_mt}월 결산`, it.adres].filter(Boolean).join(' · ') })),
        });
        if (!chosen) throw new Error('회사를 고르지 않았습니다.');
        c.corp = chosen;
        continue;
      }
      throw e;
    }
  }
}

async function getReport(c, basis, button) {
  return busy(button, '찾는 중…', async () => {
    try {
      const v = await versions(c, basis);
      const label = basis === 'con' ? '감사보고서(연결)' : '감사보고서';
      c.versions = (c.versions || []).filter((x) => x.basis !== basis).concat([{ basis, label, items: v.items || [] }]);
      const latest = (v.items || []).slice(-1)[0];
      if (!latest) throw new Error(`전자공시에 ${c.baseDt.slice(0, 4)}.${c.baseDt.slice(4, 6)} 결산기의 ${label}가 없습니다.`);
      await getPdf(c, basis, latest.receipt, null, latest);
    } catch (e) { c.msg = e.message; c.err = true; renderPicked(); }
  });
}

/* 감사보고서 바로가기 — 그 결산기 최신 발행본(정정 포함)의 DART 공시뷰어. 팝업 차단을 피하려고 창을 먼저 열고 주소를 나중에 넣는다. */
async function openReport(c, basis, button) {
  const win = window.open('about:blank', '_blank');
  return busy(button, '찾는 중…', async () => {
    try {
      const v = await versions(c, basis);
      const label = basis === 'con' ? '감사보고서(연결)' : '감사보고서';
      c.versions = (c.versions || []).filter((x) => x.basis !== basis).concat([{ basis, label, items: v.items || [] }]);
      const latest = (v.items || []).slice(-1)[0];
      if (!latest || !latest.url) throw new Error(`전자공시에 ${c.baseDt.slice(0, 4)}.${c.baseDt.slice(4, 6)} 결산기의 ${label}가 없습니다.`);
      if (win) { win.opener = null; win.location.href = latest.url; } else window.open(latest.url, '_blank', 'noopener');
      c.msg = `열었음: ${label} ${latest.filed_date}${latest.corrected ? '(정정)' : ''}`; c.err = false;
    } catch (e) { if (win) win.close(); c.msg = e.message; c.err = true; }
    renderPicked();
  });
}

async function getPdf(c, basis, receipt, button, item) {
  const it = item || (c.versions || []).flatMap((v) => v.items).find((x) => x.receipt === receipt) || {};
  const kind = basis === 'con' ? '연결감사보고서' : '감사보고서';
  const safe = String(c.company.name).replace(/[\\/:*?"<>|]/g, '_');
  const name = `${safe}_${kind}_${c.baseDt.slice(0, 6)}_${it.filed_date || receipt}${it.corrected ? '(정정)' : ''}.pdf`;
  return busy(button, '받는 중…', async () => {
    try {
      await save(await call(`/api/v1/qc-sample/dart/pdf/${receipt}`), name);
      c.msg = `받음: ${name}`; c.err = false;
    } catch (e) { c.msg = e.message; c.err = true; }
    renderPicked();
  });
}

async function getAll() {
  const list = [...state.chosen.values()];
  const wait = list.filter((c) => !c.company);
  if (wait.length) {
    await showAlert(`사내 재무 DB 회사를 아직 고르지 않은 곳이 있습니다: ${wait.map((c) => cell(c.row, 'company')).join(', ')}`, { title: '모두 받기' });
    return;
  }
  // zip 으로 한 번에(회계법인명.zip) 받을지, 지금처럼 하나씩 받을지(사용자 지정 2026-10-15)
  // 선정해야 할 수(품감 일정의 개별선정 개수)보다 적게 골랐으면 먼저 알린다(사용자 지정 2026-10-15)
  const sc = state.sched;
  const target = sc && sc.ready && $('firmName').value.trim() ? Number((firmMatch(sc.firms, $('firmName').value.trim())[0] || {}).reviews) : NaN;
  const short = Number.isFinite(target) && target > 0 && list.length < target;
  // 「닫기」 없이 YES(파랑)·NO 만(사용자 지정 2026-10-15). 창을 닫으면 받지 않는다.
  const how = await showAsk(short ? `${target}개사를 선정하여야 하는데, ${list.length}개사를 선택하였습니다. zip파일로 다운할까요?` : 'zip파일로 다운할까요?', {
    title: '선정 회사 모두 받기', buttons: [{ label: 'NO', value: 'each' }, { label: 'YES', value: 'zip', primary: true }] });
  if (how !== 'zip' && how !== 'each') return;
  if (how === 'zip') state.zipCollect = [];
  // 진행 막대 — 할 일(인뎁스 + 감사보고서 + 연결) 중 끝난 몫만큼 세 막대를 채운다
  const steps = list.reduce((n, c) => n + 2 + (isConsolidated(c.row, roles()) ? 1 : 0), 0);
  let done = 0;
  const prog = $('getAllProg');
  const tick = () => {
    const f = steps ? done / steps : 0;
    prog.hidden = false;
    prog.classList.toggle('is-wait', done === 0);
    [...prog.children].forEach((b, i) => b.style.setProperty('--fill', `${Math.max(0, Math.min(1, f * 3 - i)) * 100}%`));
  };
  const step = async (p) => { try { await p; } finally { done += 1; tick(); } };
  tick();
  try {
    await busy($('getAll'), '받는 중…', async () => {
      for (const c of list) {
        await step(getIndepth(c, null));
        await step(getReport(c, 'indi', null));
        if (isConsolidated(c.row, roles())) await step(getReport(c, 'con', null));
      }
    });
    if (how === 'zip') {
      const files = state.zipCollect;
      state.zipCollect = null;
      if (!files.length) {
        const errs = list.filter((c) => c.err && c.msg).map((c) => `${displayName(cell(c.row, 'company'))}: ${c.msg}`);
        showAlert(`받은 파일이 없습니다.${errs.length ? `\n\n${errs.join('\n')}` : ''}`, { title: '모두 받기' });
        return;
      }
      const sc = state.sched;
      const ff = sc && sc.ready ? firmMatch(sc.firms, $('firmName').value.trim())[0] : null;
      const firm = (ff && ff.firm) || ($('firmName').value.trim() ? `회계법인 ${$('firmName').value.trim()}` : '선정회사');
      const url = URL.createObjectURL(makeZip(files));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${firm.replace(/[\\/:*?"<>|]/g, '')}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast(`${files.length}개 파일을 ${a.download} 로 받았습니다(오류는 카드에 적혀 있습니다).`);
      return;
    }
  } finally { state.zipCollect = null; prog.hidden = true; }
  toast('선정 회사 자료를 모두 받았습니다(오류는 카드에 적혀 있습니다).');
}

/* ── ② 제출자료 대사 ── */

function renderReconList() {
  $('reconList').innerHTML = state.recon.files.map((f, i) =>
    `<li>${esc(f.name)}${f === state.file ? ' <span class="qs-muted">(개별 선정에서 올린 파일)</span>' : ''}
      <button type="button" data-rm="${i}" title="빼기">⨯</button></li>`).join('');
  $('reconRun').disabled = !state.recon.files.length;
  if (state.recon.last && $('reconOut').hidden) renderRecon(state.recon.last);
}

function addReconFiles(files) {
  for (const f of files) {
    if (state.recon.files.length >= 20) break;
    if (!state.recon.files.some((x) => x.name === f.name && x.size === f.size)) state.recon.files.push(f);
  }
  renderReconList();
}

async function runRecon() {
  const fd = new FormData();
  state.recon.files.forEach((f) => fd.append('files', f));
  const fy = $('reconFy').value.trim();
  if (fy) fd.append('fy', fy);
  $('reconState').textContent = '맞춰 보는 중…';
  await busy($('reconRun'), '대사 중…', async () => {
    try {
      const out = await api.upload('/qc-sample/reconcile', fd);
      state.recon.last = out;
      renderRecon(out);
      $('reconState').textContent = out.message || '';
    } catch (e) {
      $('reconState').textContent = '';
      showAlert(e.message, { title: '제출자료 대사' });
    }
  });
}

/* 비감사용역 줄 — 용역 묶음(기장·세무조정·평가·검토·인증·자문·기타)별로 「세무조정 : A(1.2백만원), B(총 4.5백만원)」(사용자 지정 2026-10-15).
   한 묶음에 3개사가 넘으면 「등 N개사 ▼」, 누르면 그 묶음 전체. */
const NAS_ORDER = ['기장', '세무조정', '평가', '검토·인증', '자문(컨설팅)', '기타'];
const mil = (f) => (f > 0 && f < 0.05 ? '0.1백만원 미만' : `${Number(f).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}백만원`);
function nasLines(l, i, co, open) {
  const groups = new Map();
  for (const it of l.items) {
    for (const g of it.nas) {
      if (!groups.has(g.group)) groups.set(g.group, []);
      groups.get(g.group).push({ company: it.company, fee: g.fee, rows: g.rows, services: g.services });
    }
  }
  const order = [...groups.keys()].sort((a, b) => NAS_ORDER.indexOf(a) - NAS_ORDER.indexOf(b));
  const sub = order.map((g) => {
    const list = groups.get(g).sort((a, b) => (b.fee ?? -1) - (a.fee ?? -1));
    const key = `${i}:${g}`;
    const brief = g === '세무조정';          // 세무조정은 상세 없이 대표 3개사 · 외 N개사(사용자 지정 2026-10-15)
    const shown = (open.has(key) && !brief) || list.length <= 3 ? list : list.slice(0, 3);
    const total = list.reduce((a, x) => a + (x.fee || 0), 0);
    const one = (x) => `${co(x.company)}${x.fee != null ? `(${x.rows > 1 ? '총 ' : ''}${mil(x.fee)})` : ''}`;
    const words = [...new Set(list.flatMap((x) => x.services))].slice(0, 4).join(', ');
    return `<div class="cp-sub" title="${esc(words)}">- <b>${esc(g)}</b> ${list.length}개사${total ? ` · 합계 ${mil(total)}` : ''} : ${shown.map(one).join(', ')}${
      list.length <= 3 ? '' : brief ? ` 외 ${list.length - 3}개사`
        : ` <a href="#" class="cp-more" data-x="${esc(key)}">${open.has(key) ? '▲' : `등 ${list.length}개사 ▼`}</a>`}</div>`;
  }).join('');
  return `<div class="cp-line">· <b>${esc(l.title)}</b></div>${sub}`;
}

/* 회사 칸 — 교차심리는 「이사(회사, 회사) ↔ 이사(회사)」, 그 밖은 회사명(2-3 에 있으면 감사보고서 링크) */
function coCell(i) {
  const link = (n) => (rowByName(n) ? `<a class="cp-co" href="#" data-co="${esc(n)}" title="${esc(reportTip(n))}">${esc(shortName(n))}</a>` : esc(displayName(n)));
  if (Array.isArray(i.pair)) {
    // 3개사가 넘으면 「A, B, C 등 N개사」 — 마우스를 올리면 전체
    const side = (x) => `<span title="${esc(x.companies.map(displayName).join(', '))}">${esc(x.partner)}(${x.companies.slice(0, 3).map(link).join(', ')}${
      x.companies.length > 3 ? ` 등 ${x.companies.length}개사` : ''})</span>`;
    return i.pair.map(side).join(' ↔ ');
  }
  if (/↔/.test(String(i.company)) || !rowByName(i.company)) return esc(displayName(i.company));
  return `<a class="cp-co" href="#" data-co="${esc(i.company)}" title="${esc(reportTip(i.company))}">${esc(displayName(i.company))}</a>`;
}

/* 점검 표 — 항목별로 묶는다(사용자 지정 2026-10-15: 더 일목요연하게). 묶음 머리줄에 구분·항목·건수·근거,
   그 아래 줄마다 회사·사업연도·내용·자료 위치. */
function issueTable(items, withBasis) {
  if (!items.length) return '<p class="qs-muted">없습니다.</p>';
  const groups = new Map();
  for (const i of items) {
    const k = `${i.level}|${i.title}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  const body = [...groups.values()].map((list) => {
    const g = list[0];
    const basis = withBasis && g.basis ? `<div class="qs-basis">${esc(g.basis)}</div>` : '';
    return `<tr class="iss-grp"><td colspan="4"><span class="lv lv-${esc(g.level)}">${esc(g.level)}</span> <b>${esc(sheetText(g.title))}</b> <span class="qs-muted">${list.length}건</span>${basis}</td></tr>`
      + list.map((i) => `<tr class="iss-row"><td class="iss-co">${coCell(i)}</td><td class="al-c">${esc(i.year ?? '')}</td>
        <td class="wrap">${esc(sheetText(i.detail))}</td><td class="iss-ref">${esc(sheetText((i.refs || []).join(', ')))}</td></tr>`).join('');
  }).join('');
  return `<div class="qs-table-wrap"><table class="qs-table iss-table"><colgroup><col style="width:26%"><col style="width:7%"><col><col style="width:13%"></colgroup>
    <thead><tr><th>회사</th><th class="al-c">사업연도</th><th>내용</th><th>자료 위치</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

/* 회사별 보기(사용자 지정 2026-10-15) — 회사마다 구분별 건수와 항목 이름, 회사명을 누르면 그 회사의 항목 목록.
   교차심리는 양쪽 이사가 맡은 회사 모두에 붙인다. 위반의심 많은 회사부터. */
function companyTable(items) {
  if (!items.length) return '<p class="qs-muted">없습니다.</p>';
  const by = new Map();
  const put = (name, i) => {
    const k = nameKey(name) || name;
    if (!by.has(k)) by.set(k, { name, items: [] });
    by.get(k).items.push(i);
  };
  for (const i of items) {
    if (Array.isArray(i.pair)) i.pair.forEach((x) => x.companies.forEach((c) => put(c, i)));
    else put(String(i.company).split(' ↔ ')[0], i);
  }
  const rank = (e) => LEVELS.map((l) => -e.items.filter((i) => i.level === l).length);
  const list = [...by.values()].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    for (let x = 0; x < ra.length; x++) if (ra[x] !== rb[x]) return ra[x] - rb[x];
    return a.name.localeCompare(b.name, 'ko');
  });
  const rows = list.map((e) => {
    const counts = LEVELS.filter((l) => l !== '일치').map((l) => [l, e.items.filter((i) => i.level === l).length]).filter(([, n]) => n)
      .map(([l, n]) => `<span class="lv lv-${esc(l)}">${esc(l)} ${n}</span>`).join(' ');
    const titles = [...new Set(e.items.map((i) => sheetText(shortTitle(i.title))))];
    const detail = e.items.map((i) => `<li><span class="lv lv-${esc(i.level)}">${esc(i.level)}</span> <b>${esc(sheetText(i.title))}</b>${
      i.detail ? ` — ${esc(sheetText(i.detail))}` : ''}${(i.refs || []).length ? ` <span class="iss-ref">(${esc(sheetText(i.refs.join(', ')))})</span>` : ''}</li>`).join('');
    const report = rowByName(e.name) ? ` <a href="#" class="qs-link" data-co="${esc(e.name)}" title="${esc(reportTip(e.name))}">감사보고서↗</a>` : '';
    return `<tr class="co-row"><td class="iss-co"><a href="#" class="co-toggle" data-cotoggle>${esc(displayName(e.name))}</a>${report}</td>
      <td>${counts}</td><td class="wrap">${esc(titles.slice(0, 4).join(' · '))}${titles.length > 4 ? ` 외 ${titles.length - 4}` : ''}</td></tr>
      <tr class="co-detail" hidden><td colspan="3"><ul class="co-items">${detail}</ul></td></tr>`;
  }).join('');
  return `<div class="qs-table-wrap"><table class="qs-table iss-table"><colgroup><col style="width:26%"><col style="width:24%"><col></colgroup>
    <thead><tr><th>회사 <span class="qs-muted qs-small">(누르면 항목 목록)</span></th><th>건수</th><th>항목</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* 조서 취합완료일 표 — 2-3 archive일·창고입고일 중 빠른 날, 개별·연결 따로 60일. 2-8 취합완료일은 맞춰 보기용. 요약 한 줄 + 펼치면 회사별 표 */
function wpTable(result) {
  const w = workpaperDates(result);
  if (!w || !w.rows.length) return '';
  const s = w.summary;
  const n = (v) => (v === null || v === undefined ? '' : v);
  const cls = (v) => (v !== null && v > 60 ? 'bad' : '');
  const head = `당기 ${s.total}개사 · 60일 초과: 개별 ${s.over}개사, 연결 ${s.con_over}개사`
    + (s.with28 ? sheetText(` · 2-8 취합완료일과 같음 ${s.same} · 다름 ${s.diff}`) : '');
  return `<details class="qs-fold"><summary>조서 취합완료일(감사보고서일부터 60일)</summary><div>
    <p class="qs-muted qs-small">${esc(head)}<br>조서 취합완료일은 2-3. 외감회사의 전산조서 archive일 · 서면조서 창고입고일 중 빠른 날입니다(둘 중 하나만 적혔으면 그 날). 개별은 감사보고서일, 연결은 연결감사보고서일부터 셉니다. 2-8. 자체조서점검의 취합완료일은 맞춰 보기용입니다.</p>
    <div class="qs-table-wrap"><table class="qs-table"><thead><tr><th>회사</th><th>감사보고서일</th><th>archive일</th><th>창고입고일</th><th>취합완료일</th><th>경과일</th><th>연결보고서일</th><th>연결 취합완료일</th><th>연결 경과일</th><th>2-8. 자체조서점검 취합완료일</th></tr></thead><tbody>${
      w.rows.map((r) => `<tr><td>${esc(displayName(r.company))}</td><td>${r.rd}</td><td>${r.archive}</td><td>${r.warehouse}</td><td>${r.collect}</td>
        <td class="num ${cls(r.days)}">${n(r.days)}</td><td>${r.crd}</td><td>${r.con_collect}</td><td class="num ${cls(r.con_days)}">${n(r.con_days)}</td>
        <td${r.gap ? ' class="bad" title="2-3. 외감회사 취합완료일과 다름"' : ''}>${r.c28}</td></tr>`).join('')}</tbody></table></div></div></details>`;
}

function renderRecon(out) {
  const box = $('reconOut');
  box.hidden = false;
  const r = out.result;
  const files = (out.files || []).map((f) => {
    let what = '';
    if (f.error) what = `<span class="msg err">${esc(f.error)}</span>`;
    else if (f.kind === '엑셀') what = (f.found || []).length ? `읽은 시트: ${esc(f.found.join(', '))}` : `맞는 시트 없음 (${esc((f.sheets || []).join(', '))})`;
    else {
      const x = f.facts || {};
      what = x.type === '감사보고서'
        ? `감사보고서 · ${esc(f.company || '회사 못 찾음')} · 보고서일 ${esc(x.report_date || '-')} · 의견 ${esc(x.opinion || '-')} · 업무수행이사 ${esc(x.partner || '-')}`
        : `${esc(x.type || '문서')} · ${f.chars ? `${f.chars.toLocaleString('ko-KR')}자` : ''}${f.company ? ` · 가장 많이 나온 회사 ${esc(f.company)}(${f.hits}회)` : ''}`;
    }
    return `<tr><td>${esc(f.name)}</td><td>${esc(f.kind)}</td><td class="wrap">${what}</td></tr>`;
  }).join('');
  if (!r) {
    box.innerHTML = `<section class="qs-card"><div class="qs-card-head"><h2>자료 요약</h2></div>
      <div class="qs-table-wrap"><table class="qs-table"><thead><tr><th>파일</th><th>종류</th><th>읽은 내용</th></tr></thead><tbody>${files}</tbody></table></div></section>`;
    return;
  }
  const ch = r.checks;
  const items = ch.items.filter((i) => !state.recon.hidden.has(i.level));
  const sheets = Object.entries(ch.sheets).map(([k, v]) => { const c = { s23: '2-3', s28: '2-8', s210: '2-10', s410: '4-10', s83: '8-3' }[k]; return `${c}. ${SHEET_NAMES[c]} ${v ? '○' : '없음'}`; }).join(' · ');
  if (!$('reconFy').value) $('reconFy').placeholder = `자동(${ch.fy})`;
  box.innerHTML = `
    <section class="qs-card">
      <div class="qs-card-head"><h2>중요 체크포인트</h2>
        <span class="qs-muted">당기 = FY${ch.fy} · 시트 ${esc(sheets)}</span><span class="qs-grow"></span>
        <button class="qs-btn" type="button" id="reconCopy">엑셀 복사</button></div>
      <div class="qs-sum">${LEVELS.filter((l) => l !== '일치').map((l) =>
        `<button type="button" class="lv lv-${l} ${state.recon.hidden.has(l) ? 'off' : ''}" data-lv="${l}">${l} ${ch.summary[l] || 0}</button>`).join('')}
        <span class="lv lv-일치">일치 ${ch.summary['일치'] || 0}</span>
        <span class="qs-grow"></span>
        <span class="iss-view">${[['item', '항목별'], ['co', '회사별']].map(([v, t]) =>
          `<button type="button" class="${state.recon.view === v ? 'on' : ''}" data-view="${v}">${t}</button>`).join('')}</span></div>
      ${state.recon.view === 'co' ? companyTable(items) : issueTable(items, true)}
      <details class="qs-fold"><summary>일치·특이사항 없음 ${ch.ok.length}건 (펼치기)</summary><div>${issueTable(ch.ok, false)}</div></details>
      ${wpTable(r)}
      ${ch.aliases.length ? `<details class="qs-fold"><summary>같은 회사로 본 표기 ${ch.aliases.length}건</summary><div><ul>${
        ch.aliases.map((a) => `<li>${a.names.map(esc).join(' = ')}</li>`).join('')}</ul></div></details>` : ''}
    </section>
    <section class="qs-card"><div class="qs-card-head"><h2>자료 요약</h2></div>
      <div class="qs-table-wrap"><table class="qs-table"><thead><tr><th>파일</th><th>종류</th><th>읽은 내용</th></tr></thead><tbody>${files}</tbody></table></div></section>`;
  box.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { state.recon.view = b.dataset.view; renderRecon(out); }));
  box.querySelectorAll('[data-cotoggle]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    const tr = b.closest('tr').nextElementSibling;
    tr.hidden = !tr.hidden;
    b.closest('tr').classList.toggle('is-open', !tr.hidden);
  }));
  box.querySelectorAll('[data-lv]').forEach((b) => b.addEventListener('click', () => {
    const l = b.dataset.lv;
    if (state.recon.hidden.has(l)) state.recon.hidden.delete(l); else state.recon.hidden.add(l);
    renderRecon(out);
  }));
  $('reconCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(issuesTsv(items)); toast('복사했습니다 — 엑셀에 붙여 넣으세요.'); } catch { showAlert('복사하지 못했습니다.', { title: '엑셀 복사' }); }
  });
}

/* ── 완전성: 회계법인사업보고서 외감실적 ↔ 사전제출자료 회사 수 (기존 /qc API 그대로) ── */

function presubmitCounts() {
  const d = (state.recon.last && state.recon.last.result) || state.data;
  if (!d) return null;
  const r = d.roles || {};
  const out = { 당기: new Set(), 전기: new Set(), 당기연결: new Set(), 전기연결: new Set() };
  for (const row of d.rows) {
    const y = String(row.values[r.year] || '당기');
    const k = (y.startsWith('전기') ? '전기' : y.startsWith('당기') ? '당기' : null);
    if (!k) continue;
    const key = String(row.values[r.company] || '').replace(/주식회사|\(주\)|㈜|\s/g, '');
    out[k].add(key);
    if (isConsolidated(row, r)) out[`${k}연결`].add(key);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.size]));
}

/* 감사인(대상 회계법인) 이름 — DART 에 같은 이름 회사가 여럿이면 이 법인이 감사보고서 제출인인 회사로 가른다(사용자 지정 2026-10-15) */
function auditorName() {
  const q = $('firmName').value.trim();
  const sc = state.sched;
  const f = sc && sc.ready && q ? firmMatch(sc.firms, q)[0] : null;
  return (f && f.firm) || q || '';
}

function guessFirm() {
  return guessFirmFrom((state.recon.files[0] || state.file || {}).name || '');
}

function guessFirmFrom(name) {
  const m = /회계법인\s*([가-힣A-Za-z]{2,})|([가-힣A-Za-z]{2,})\s*회계법인/.exec(String(name || ''));
  return m ? (m[1] || m[2]) : '';
}

/* 카드 정보 한 줄(사용자 지정 2026-10-15) — 겹치지 않게 한 번씩: 「이사 윤가원 · 초도 · 연결 · K-IFRS · 기타 · 26.3.27」.
   고를 때 걸려 있던 슬라이서 값은 빨강(#c00000). 당기는 적지 않고 전기만 빨간 「전기」. 감사보고서일은 yy.m.d 로 맨 끝. */
function cardInfo(c) {
  const r = c.row;
  // 선정 근거 = 슬라이서마다 한 묶음(「일반/K-IFRS」처럼 여러 값은 「/」). 「초도·지정」만 낱말로 쪼갠다 — 「부동산·임대업」은 그대로
  const groups = (c.basis || []).map((b) => String(b).replace(/·?자유수임/g, '').replace(/지정감사/g, '지정').split('/')
    .flatMap((x) => (/^(초도|계속)(·지정)?$/.test(x.trim()) ? x.split('·') : [x])).map((x) => x.trim()).filter(Boolean));
  const picked = new Set(groups.flat());
  const used = new Set();
  const out = [];
  const add = (text, keys = [text], force = false, prefix = '') => {
    if (!text || text === '(빈 칸)') return;
    const hit = force || keys.some((k) => picked.has(String(k)));
    keys.forEach((k) => used.add(String(k)));
    // 강조는 값에만(「이사」 같은 말머리는 그대로, 사용자 지정 2026-10-15)
    out.push(`${prefix}${hit ? `<span class="pk-sel">${esc(text)}</span>` : esc(text)}`);
  };
  if (String(cell(r, 'year') || '').startsWith('전기')) add('전기', ['전기'], true);
  if (cell(r, 'partner')) add(String(cell(r, 'partner')), [cell(r, 'partner')], false, '이사 ');
  const first = shortFirst(valueOf(r, '@first', roles()));
  first.split('·').filter(Boolean).forEach((x) => add(x));
  if (isConsolidated(r, roles())) add('연결');
  add(gaapShort(valueOf(r, '@gaap', roles())));
  const grp = valueOf(r, '@industry', roles());
  if (picked.has(grp)) add(grp); else add(cell(r, 'industry'), [cell(r, 'industry'), grp]);
  const br = String(valueOf(r, '@branch', roles())).replace(/^본점·/, '');
  if (picked.has(br)) add(br);
  // 그 밖에 고른 슬라이서(감사의견·회사 분류 …) — 그 묶음 값이 아직 하나도 안 나왔고 값이 하나일 때만(여러 값이면 이 회사가 어느 것인지 모름)
  for (const g of groups) {
    if (g.some((k) => used.has(k)) || g.length !== 1) continue;
    const k = g[0];
    if (k !== '당기' && k !== '중요 체크포인트') add(k);
  }
  if ((c.basis || []).includes('중요 체크포인트')) add('중요 체크포인트', ['중요 체크포인트']);
  const rdm = /^\d{2}(\d{2})-(\d{2})-(\d{2})/.exec(String(cell(r, 'report_date') || ''));
  if (rdm) out.push(`${rdm[1]}.${+rdm[2]}.${+rdm[3]}`);
  // 감사보고서일 옆에 총자산·당기순이익(억원, 손실은 괄호) — 사전제출자료 금액은 백만원(사용자 지정 2026-10-15)
  const eok = (v) => {
    const n = Number(String(v ?? '').replace(/,/g, ''));
    if (!Number.isFinite(n) || String(v ?? '').trim() === '') return '';
    const t = Math.round(Math.abs(n) / 100).toLocaleString('ko-KR');
    return n < 0 ? `(${t})억` : `${t}억`;
  };
  if (eok(cell(r, 'assets'))) out.push(`총자산 ${eok(cell(r, 'assets'))}`);
  if (eok(cell(r, 'net_income'))) out.push(`NI ${eok(cell(r, 'net_income'))}`);
  return out.join(' · ');
}

/* 고를 때 걸려 있던 슬라이서 값 — 선정 회사 카드에 작은 글씨로(사용자 지정 2026-10-15). 사업연도는 빼고, 짧게 */
function pickBasis() {
  const d = state.data;
  const yearId = d.roles.year ? `col:${d.roles.year}` : '';
  const out = [];
  for (const id of state.slicers.concat(Object.keys(state.picked).filter((k) => !state.slicers.includes(k)))) {
    const set = state.picked[id];
    if (!set || !set.size || id === yearId || out.some((x) => x.id === id)) continue;
    const vals = [...set].map((v) => (id === '@gaap' ? gaapShort(v) : id === '@con_report' ? (/^연결/.test(v) ? '연결' : v) : id === '@branch' ? String(v).replace(/^본점·/, '') : v));
    out.push({ id, text: vals.join('/') });
  }
  return out.map((x) => x.text);
}

/* ── 선택 내역 — 이 컴퓨터(브라우저 IndexedDB)에만, 회계법인마다(사용자 지정 2026-10-15). 그 회계법인 자료를 열면 되살린다. ── */
function pickKey() {
  const firm = $('firmName').value.trim();
  return firm ? `firm:${nameKey(firm)}` : `file:${state.shownFile || ''}`;
}
async function picksGet(key) {
  try {
    const db = await recentDb();
    return await new Promise((res) => { const t = db.transaction('picks').objectStore('picks').get(key); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); });
  } catch { return null; }
}
async function picksWrite(fn) {
  try {
    const db = await recentDb();
    await new Promise((res) => { const tx = db.transaction('picks', 'readwrite'); fn(tx.objectStore('picks')); tx.oncomplete = res; tx.onerror = res; tx.onabort = res; });
    return true;
  } catch { return false; }
}
async function savePicks() {
  const list = [...state.chosen.values()];
  if (!list.length) { showAlert('선정 회사가 없습니다.', { title: '선택내역저장' }); return; }
  const rec = { key: pickKey(), firm: $('firmName').value.trim(), at: new Date().toISOString(),
    rows: list.map((c) => ({ row: c.row.row, name: cell(c.row, 'company'), basis: c.basis || [] })),
    opts: Object.fromEntries(['optKind', 'optLead', 'optMember', 'optSchedule'].map((id) => [id, $(id).value])) };
  const ok = await picksWrite((st) => st.put(rec));
  toast(ok ? `선택 내역 ${list.length}개사를 이 컴퓨터에 저장했습니다 — 이 회계법인을 다시 열면 보입니다.` : '이 브라우저에는 저장할 수 없습니다.');
}
async function deletePicks() {
  const ok = await showConfirm('내 컴퓨터에 저장된 선택된 회사에 대한 정보가 지워집니다. 지울까요?', { title: '내역삭제', okText: 'YES', cancelText: 'NO', danger: true });
  if (!ok) return;
  const key = pickKey();
  await picksWrite((st) => { st.delete(key); st.delete(`auto:${key}`); });
  toast('이 컴퓨터에 저장된 선택 내역(선정 근거)을 지웠습니다.');
}
/* 저장을 누르지 않아도 지금 고른 회사·슬라이서를 자동으로 남긴다(사용자 지정 2026-10-15: 중간에 고른 것이 없어짐) */
let autoTimer = null;
function autoSavePicks() {
  if (!state.data || state.restoring) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    const rec = { key: `auto:${pickKey()}`, at: new Date().toISOString(),
      rows: [...state.chosen.values()].map((c) => ({ row: c.row.row, name: cell(c.row, 'company'), basis: c.basis || [] })),
      opts: Object.fromEntries(['optKind', 'optLead', 'optMember', 'optSchedule'].map((id) => [id, $(id).value])),
      picked: Object.fromEntries(Object.entries(state.picked).filter(([, set]) => set && set.size).map(([id, set]) => [id, [...set]])),
      slicers: [...state.slicers] };
    picksWrite((st) => st.put(rec));
  }, 300);
}

async function restorePicks() {
  // 저장한 것과 자동으로 남은 것 중 더 최근 것
  const [saved, auto] = await Promise.all([picksGet(pickKey()), picksGet(`auto:${pickKey()}`)]);
  const rec = auto && (!saved || String(auto.at) > String(saved.at)) ? auto : saved;
  state.restoring = false;
  if (!rec) return;
  if (rec.slicers && rec.slicers.length) state.slicers = rec.slicers.filter((id) => slicerChoices(state.data).some((c) => c.id === id));
  if (rec.picked) state.picked = Object.fromEntries(Object.entries(rec.picked).map(([id, vals]) => [id, new Set(vals)]));
  let n = 0;
  for (const p of rec.rows) {
    const row = state.data.rows.find((r) => r.row === p.row && nameKey(cell(r, 'company')) === nameKey(p.name)) || rowByName(p.name);
    if (!row || state.chosen.has(row.row)) continue;
    state.chosen.set(row.row, { row, msg: '', err: false, corp: '', basis: p.basis || [] });
    resolveCompany(state.chosen.get(row.row));
    n += 1;
  }
  for (const [id, v] of Object.entries(rec.opts || {})) if ($(id) && v) $(id).value = v;
  renderSlicers();
  renderPicked();
  if (n) toast(`${rec === auto ? '마지막으로 고른' : '저장해 둔'} 선택 내역 ${n}개사를 불러왔습니다(${String(rec.at).slice(5, 16).replace('-', '/').replace('T', ' ')}).`);
}

/* ── 최근 사전제출자료 — 각자 컴퓨터(브라우저 IndexedDB)에만, 서버에는 남기지 않는다(사용자 지정 2026-10-15) ──
   회계법인마다 하나, 최근 3곳까지. 화면을 열면 가장 최근 것을 바로 보이고, 위 「최근 자료」에서 바꿔 볼 수 있다. */
const RECENT_MAX = 3;
function recentDb() {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') { rej(new Error('no indexedDB')); return; }
    const q = indexedDB.open('qcSample', 2);
    q.onupgradeneeded = () => {
      const db = q.result;
      if (!db.objectStoreNames.contains('recent')) db.createObjectStore('recent', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('picks')) db.createObjectStore('picks', { keyPath: 'key' });   // 선택 내역(회계법인마다)
    };
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function recentList() {
  try {
    const db = await recentDb();
    return await new Promise((res) => {
      const t = db.transaction('recent').objectStore('recent').getAll();
      t.onsuccess = () => res((t.result || []).sort((a, b) => String(b.at).localeCompare(String(a.at))));
      t.onerror = () => res([]);
    });
  } catch { return []; }
}
async function recentWrite(fn) {
  try {
    const db = await recentDb();
    await new Promise((res) => { const tx = db.transaction('recent', 'readwrite'); fn(tx.objectStore('recent')); tx.oncomplete = res; tx.onerror = res; tx.onabort = res; });
  } catch { /* 저장 못 해도 화면은 그대로 */ }
}
async function recentSave(fileName) {
  const firm = $('firmName').value.trim();
  const key = firm ? `firm:${nameKey(firm)}` : `file:${fileName}`;
  await recentWrite((st) => st.put({ key, firm, fileName, at: new Date().toISOString(), data: state.data }));
  const all = await recentList();
  if (all.length > RECENT_MAX) await recentWrite((st) => all.slice(RECENT_MAX).forEach((r) => st.delete(r.key)));
  renderRecent();
}
async function renderRecent(current) {
  const all = await recentList();
  const sel = $('recentSel');
  sel.hidden = !all.length;
  const cur = current || (all[0] && all[0].key);
  sel.innerHTML = all.map((r) => `<option value="${esc(r.key)}"${r.key === cur ? ' selected' : ''}>최근: ${esc(r.firm ? `회계법인 ${r.firm}` : r.fileName)} (${esc(String(r.at).slice(5, 10).replace('-', '/'))})</option>`).join('')
    + '<option value="__clear">이 컴퓨터에서 최근 자료 지우기</option>';
}
async function recentOpen(key) {
  const all = await recentList();
  const r = key ? all.find((x) => x.key === key) : all[0];
  if (!r) return false;
  state.data = r.data;
  state.file = null;
  state.shownFile = r.fileName;
  $('firmName').value = r.firm || '';
  await showPresubmit(r.fileName);
  await renderRecent(r.key);
  return true;
}
async function onRecentChange() {
  const v = $('recentSel').value;
  if (v === '__clear') {
    const ok = await showConfirm('이 컴퓨터에 저장된 최근 사전제출자료를 모두 지울까요? (서버에는 원래 없습니다)', { title: '최근 자료', okText: '지우기', danger: true });
    if (ok) { const all = await recentList(); await recentWrite((st) => all.forEach((r) => st.delete(r.key))); toast('이 컴퓨터의 최근 자료를 지웠습니다.'); }
    renderRecent();
    return;
  }
  recentOpen(v);
}

async function firmFind() {
  const q = $('firmQ').value.trim();
  if (!q) return;
  try {
    const res = await api.get(`/qc/firms?q=${encodeURIComponent(q)}`);
    const items = res.items || [];
    $('firmSel').innerHTML = items.map((f) => `<option value="${esc(f.corp_code)}">${esc(f.corp_name)}</option>`).join('');
    $('firmSel').hidden = !items.length;
    if (!items.length) { $('firmOut').innerHTML = '<p class="qs-muted">그 이름의 회계법인을 찾지 못했습니다.</p>'; return; }
    await firmReports();
  } catch (e) { showAlert(e.message, { title: '회계법인 찾기' }); }
}

async function firmReports() {
  try {
    const res = await api.get(`/qc/firms/${$('firmSel').value}/reports`);
    $('firmRep').innerHTML = res.items.map((it) => `<option value="${it.rcept_no}">${esc(it.report_nm)} · ${esc(it.rcept_dt)}</option>`).join('');
    $('firmRep').hidden = $('firmRun').hidden = false;
  } catch (e) { $('firmRep').hidden = $('firmRun').hidden = true; showAlert(e.message, { title: '회계법인사업보고서' }); }
}

async function firmRun() {
  const counts = presubmitCounts();
  await busy($('firmRun'), '읽는 중…', async () => {
    try {
      const p = await api.get(`/qc/reports/${$('firmRep').value}/profile?corp_code=${$('firmSel').value}`);
      const ac = p.audit_counts || {};
      const row = (label, rep, mine) => {
        const diff = rep != null && mine != null ? mine - rep : null;
        const cls = diff ? 'bad' : diff === 0 ? 'good' : '';
        return `<tr><td>${label}</td><td class="num">${rep ?? '-'}</td><td class="num">${mine ?? '-'}</td>
          <td class="num ${cls}">${diff == null ? '-' : diff === 0 ? '일치' : (diff > 0 ? '+' : '') + diff}</td></tr>`;
      };
      const fiscal = typeof p.fiscal === 'string' ? p.fiscal : (p.fiscal && (p.fiscal.text || [p.fiscal.start, p.fiscal.end].filter(Boolean).join('~'))) || '';
      const term = p.term || fiscal ? ` · ${p.term ? `제${p.term}기 ` : ''}${esc(fiscal)}` : '';
      $('firmOut').innerHTML = `<div class="qs-table-wrap"><table class="qs-table"><thead><tr><th>구분</th><th>사업보고서 감사실적</th><th>사전제출자료(회사 수)</th><th>차이</th></tr></thead><tbody>
        ${row('개별(별도) 외감 — 당기', (ac.indi || {}).total?.[0], counts?.당기)}
        ${row('개별(별도) 외감 — 전기', (ac.indi || {}).total?.[1], counts?.전기)}
        ${row('연결 — 당기', (ac.con || {}).total?.[0], counts?.당기연결)}
        ${row('연결 — 전기', (ac.con || {}).total?.[1], counts?.전기연결)}
      </tbody></table></div>
      <p class="qs-muted qs-small">${esc($('firmRep').selectedOptions[0]?.textContent || '')}${term}. 회계법인의 사업연도(예: 4월~3월)와 회사들의 결산기가 달라 차이가 날 수 있습니다 — 차이가 나면 누락·중복 회사가 있는지 확인하세요.
      ${(p.warnings || []).length ? `<br>읽기 경고: ${p.warnings.map(esc).join(' · ')}` : ''}</p>`;
    } catch (e) { showAlert(e.message, { title: '외감실적 대사' }); }
  });
}

/* 회사명 → 2-3 의 당기 줄(없으면 아무 줄) */
function rowByName(name) {
  if (!state.data) return null;
  const k = nameKey(String(name || '').replace(/\(연결\)$/, '')), yid = state.data.roles.year;
  const rows = state.data.rows.filter((r) => nameKey(r.values[state.data.roles.company]) === k);
  const cur = rows.find((r) => yid && String(r.values[yid] || '').startsWith('당기'));
  if (cur) return cur;
  // 사업연도를 「2025」처럼 숫자로 적은 파일 — 감사보고서일(없으면 사업연도)이 가장 늦은 줄(사용자 지적 2026-10-15: 전기 보고서가 열림)
  const rd = (r) => String(r.values[state.data.roles.report_date] || '') || String(r.values[yid] || '');
  return [...rows].sort((a, b) => rd(b).localeCompare(rd(a)))[0] || null;
}

/* 체크포인트에서 고른 회사를 선정 목록에 넣는다 — 이미 있으면 건너뜀. 넣은 수를 돌려준다. */
function addChosenByNames(names) {
  let n = 0;
  for (const name of names) {
    const row = rowByName(name);
    if (!row || state.chosen.has(row.row)) continue;
    state.chosen.set(row.row, { row, msg: '', err: false, corp: '', basis: ['중요 체크포인트'] });
    resolveCompany(state.chosen.get(row.row));
    n += 1;
  }
  if (n) { renderHits(); renderPicked(); }
  return n;
}

/* 2-3 줄의 감사보고서일로 그 감사보고서의 결산기 — {year, month, rd}(결산월이 보고서 달과 같거나 뒤면 전년도) */
function reportPeriodOf(row) {
  const rd = row ? String(cell(row, 'report_date') || '') : '';
  const m = /^(\d{4})-(\d{2})/.exec(rd);
  const fiscal = row ? /(\d{1,2})\s*월/.exec(String(cell(row, 'fiscal') || '')) : null;
  const month = fiscal ? Number(fiscal[1]) : 12;
  let year = m ? +m[1] : (state.data && state.data.checks ? state.data.checks.fy + 1 : new Date().getFullYear());
  if (!m || month >= +m[2]) year -= 1;
  // 당기 기준(사용자 지정 2026-10-15) — 12월 결산은 사전제출자료의 당기 사업연도로 연다. 회사 줄의 감사보고서일이 늦게 낸
  // 전년도 보고서(예: 2025-04)라도 당기(FY2025) 보고서가 열린다.
  const fy = state.data && state.data.checks && state.data.checks.fy;
  if (fy && month === 12) year = fy;
  return { year, month, rd: m ? rd.slice(0, 10) : '' };
}

/* 회사명 링크의 마우스 오버 — 어느 결산기 보고서를 여는지와 그 기준 */
function reportTip(name) {
  const row = rowByName(name);
  if (!row) return '감사보고서 열기';
  const p = reportPeriodOf(row);
  return `당기 FY${p.year}${p.month !== 12 ? `.${p.month}` : ''} 감사보고서 열기`;
}

/* 회사명으로 그 결산기 감사보고서(DART 공시뷰어) 열기 */
async function openReportByName(name) {
  const row = rowByName(name);
  const win = window.open('about:blank', '_blank');
  try {
    const { year, month } = reportPeriodOf(row);
    let corp = '';
    for (;;) {
      const q = new URLSearchParams({ company: searchTerm(name), year: String(year), basis: 'indi', fiscal_month: String(month), auditor: auditorName() });
      if (corp) q.set('corp_code', corp);
      try {
        const v = await (await call(`/api/v1/finstmt/dart/report-versions?${q}`)).json();
        const latest = (v.items || []).slice(-1)[0];
        if (!latest || !latest.url) throw new Error(`전자공시에 ${year}.${String(month).padStart(2, '0')} 결산기 감사보고서가 없습니다.`);
        if (win) { win.opener = null; win.location.href = latest.url; } else window.open(latest.url, '_blank', 'noopener');
        return;
      } catch (e) {
        if (e.status === 409 && e.detail && Array.isArray(e.detail.candidates)) {
          corp = await showChoice({ title: '어느 회사입니까?', body: e.detail.message,
            options: e.detail.candidates.map((it) => ({ value: it.corp_code, label: `${it.corp_name} (${it.corp_code})`, hint: [it.ceo_nm && `대표 ${it.ceo_nm}`, it.adres].filter(Boolean).join(' · ') })) });
          if (corp) continue;
          if (win) win.close();
          return;
        }
        throw e;
      }
    }
  } catch (e) { if (win) win.close(); showAlert(e.message, { title: displayName(name) }); }
}

/* ── ④ 기타 대사 ── */

state.other = { pre: null, files: [], last: null };

function otherPre() { return state.other.pre || state.file; }

function renderOtherList() {
  const pre = otherPre();
  $('otherPre').innerHTML = pre ? `사전제출자료: <b>${esc(pre.name)}</b>${state.other.pre ? '' : ' (개별 선정에서 올린 파일)'}` : '사전제출자료를 먼저 올려 주세요(개별 선정 탭 또는 오른쪽 단추).';
  $('otherList').innerHTML = state.other.files.map((f, i) => `<li>${esc(f.name)} <button type="button" data-rm="${i}" title="빼기">⨯</button></li>`).join('');
  $('otherRun').disabled = !(pre && state.other.files.length);
}

async function runOther() {
  const fd = new FormData();
  fd.append('presubmit', otherPre());
  state.other.files.forEach((f) => fd.append('files', f));
  $('otherState').textContent = '맞춰 보는 중…';
  await busy($('otherRun'), '대사 중…', async () => {
    try {
      state.other.last = await api.upload('/qc-sample/other', fd);
      renderOther(state.other.last);
      $('otherState').textContent = '';
    } catch (e) { $('otherState').textContent = ''; showAlert(e.message, { title: '기타 대사' }); }
  });
}

function renderOther(out) {
  const box = $('otherOut');
  box.hidden = false;
  const okAll = [...(out.internal_ok || []), ...(out.ok || [])];
  const sum = (out.summary || []).map((r) => `<li><b>${esc(r.label)}</b> — 일치 ${r.ok}${r.diff ? ` · <span class="bad">다름 ${r.diff}</span>` : ''}</li>`).join('');
  const files = (out.files || []).map((f) => `<tr><td>${esc(f.name)}</td><td class="num">${f.tables}</td><td class="num">${f.rows}</td><td>${f.report ? '감사보고서 읽음' : ''}</td><td class="wrap">${esc(f.note || '')}</td></tr>`).join('');
  box.innerHTML = `
    <section class="qs-card">
      <div class="qs-card-head"><h2>대사 결과</h2>
        <span class="qs-muted">당기 = FY${esc(out.fy)} · 사전제출자료 ${esc(out.presubmit.name)} (${esc([out.presubmit.sheet, ...(out.presubmit.others || [])].join(', '))})</span>
        <span class="qs-grow"></span><button class="qs-btn" type="button" id="otherCopy">엑셀 복사</button></div>
      <div class="qs-sum"><span class="lv lv-불일치">사전제출자료 안 불일치 ${out.internal.length}</span>
        <span class="lv lv-위반의심">첨부 자료와 다름 ${out.items.filter((i) => i.level === '불일치').length}</span>
        <span class="lv lv-참고">참고 ${out.items.filter((i) => i.level === '참고').length}</span>
        <span class="lv lv-일치">일치 ${okAll.length}</span></div>
      <h3 class="qs-sub">① 사전제출자료 안에서 같은 회사를 다르게 적은 것(2-3. 외감회사 ↔ 2-8. 자체조서점검 ↔ 2-10. 이사교체현황)</h3>
      ${issueTable(out.internal, false)}
      <h3 class="qs-sub">② 첨부 자료와 다른 내역</h3>
      ${issueTable(out.items, false)}
      <details class="qs-fold"><summary>③ 맞춰 본 항목 — 일치·특이사항 없음 ${okAll.length}건 (펼치기)</summary><div>
        ${sum ? `<ul class="qs-sumlist">${sum}</ul>` : ''}${issueTable(okAll, false)}</div></details>
      <details class="qs-fold"><summary>읽은 자료 ${(out.files || []).length}개</summary><div>
        <div class="qs-table-wrap"><table class="qs-table"><thead><tr><th>파일</th><th>읽은 표</th><th>맞춘 줄</th><th>문서</th><th>비고</th></tr></thead><tbody>${files}</tbody></table></div></div></details>
    </section>`;
  $('otherCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(issuesTsv([...out.internal, ...out.items])); toast('복사했습니다 — 엑셀에 붙여 넣으세요.'); } catch { showAlert('복사하지 못했습니다.', { title: '엑셀 복사' }); }
  });
}

/* ── 관리자설정(관리자만) ── 캘린더에서 회계법인을 눌러 일정·인원을 고친다(사용자 지정 2026-10-15).
   관리자설정을 연 동안만 「개별 선정」 탭의 대상 회계법인·명부 단추가 보인다. */

function setAdminMode(on) {
  state.adminMode = !!(on && state.admin);
  $('adminPanel').hidden = !state.adminMode;
  $('pickAdminBar').hidden = !state.adminMode;
  $('adminOpen').classList.toggle('qs-primary', state.adminMode);
  if (state.adminMode) renderAdmin();
}

const WDK = '일월화수목금토';
const mdw = (iso) => { const d = new Date(`${iso}T00:00:00`); return `${d.getMonth() + 1}/${d.getDate()}(${WDK[d.getDay()]})`; };

async function renderAdmin() {
  const box = $('adminPanel');
  const sc = state.sched || {};
  const adj = sc.adjust || { firm_overrides: {}, meeting_people: {} };
  let regs = state.adminRegs;
  if (!regs) { try { regs = state.adminRegs = await api.get('/qc-sample/registers'); } catch { regs = {}; } }
  const firms = sc.firms || [];
  state.adminFirms = firms;
  const months = eventMonths(firms.filter((f) => f.start && f.end));
  const nowYm = new Date().toISOString().slice(0, 7);
  if (!state.admMonth || !months.includes(state.admMonth)) state.admMonth = months.includes(nowYm) ? nowYm : (months.find((m) => m >= nowYm) || months[months.length - 1] || nowYm);
  const ym = state.admMonth, mi = months.indexOf(ym);
  const weeks = calendarWeeks(ym, firms);
  const hol = state.holidays || {};
  const cal = weeks.map((w) => `<div class="adm-week">${w.days.map((d) => `<div class="adm-day${d.slice(0, 7) !== ym ? ' is-out' : ''}${hol[d] ? ' is-hol' : ''}${d === isoToday() ? ' is-today' : ''}">${mdw(d)}${hol[d] ? ` <small>${esc(hol[d])}</small>` : ''}</div>`).join('')}${
    w.bars.map((b) => { const f = b.firm, i = firms.indexOf(f);
      return `<button type="button" class="adm-bar${adj.firm_overrides[f.firm] ? ' is-adj' : ''}${state.admFirm === f.firm ? ' is-sel' : ''}${b.cutL ? ' cut-l' : ''}${b.cutR ? ' cut-r' : ''}" style="grid-column:${b.from + 1}/${b.to + 2}" data-adm="pick" data-fi="${i}" title="${esc(`${f.firm} ${f.start}~${f.end} · 팀장 ${f.lead || '-'} · 팀원 ${f.member || '-'}`)}"><b>${esc(short(f))}</b> <span>${esc(f.lead || '-')} · ${esc(f.member || '-')}</span></button>`; }).join('')}</div>`).join('');
  const rules = Object.entries(adj.meeting_people || {}).flatMap(([day, r]) => Object.entries(r).map(([word, names]) => ({ day, word, names })));
  const sel = firms.find((f) => f.firm === state.admFirm);
  box.innerHTML = `
    <div class="qs-card-head"><h2>관리자설정</h2><span class="qs-muted">고친 값은 일정 엑셀을 다시 올려도 유지되고, 바뀐 내용은 품감 일정 아래 「변경 이력」(올해분)에 남습니다.</span>
      <span class="qs-grow"></span><button class="qs-btn qs-small-btn" type="button" data-adm="close">닫기</button></div>
    <datalist id="admStaff">${(sc.staff || []).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
    <h3 class="qs-sub">① 회계법인 감리 일정·인원 — 캘린더에서 회계법인을 누르세요</h3>
    <div class="adm-nav"><button class="qs-btn qs-small-btn" type="button" data-adm="mprev" ${mi > 0 ? '' : 'disabled'}>‹</button><b>${ym.replace('-', '년 ')}월</b><button class="qs-btn qs-small-btn" type="button" data-adm="mnext" ${mi >= 0 && mi < months.length - 1 ? '' : 'disabled'}>›</button>
      <span class="qs-muted qs-small">팀장 · 팀원 순 · <span class="adm-key is-adj">조정됨</span></span></div>
    <div class="adm-cal">${cal || '<p class="qs-muted">이 달에는 일정이 없습니다.</p>'}</div>
    ${sel ? adminEditHtml(sel, !!adj.firm_overrides[sel.firm]) : ''}
    <h3 class="qs-sub">② 회의 참석자 — 그날 그 회의는 적힌 사람에게만 보입니다</h3>
    <table class="qs-table adm-meet"><thead><tr><th>날짜</th><th>회의 이름(일부)</th><th>참석자(쉼표로)</th><th></th></tr></thead><tbody>${
      rules.map((r) => `<tr><td><input class="qs-input" type="date" value="${esc(r.day)}" data-m="day"></td><td><input class="qs-input" value="${esc(r.word)}" data-m="word"></td>
        <td><input class="qs-input adm-wide" value="${esc(r.names.join(', '))}" data-m="names"></td><td><button class="qs-link" type="button" data-adm="mdel">빼기</button></td></tr>`).join('')}</tbody></table>
    <div class="qs-opts"><button class="qs-btn qs-small-btn" type="button" data-adm="madd">+ 줄 더하기</button><button class="qs-btn qs-small-btn qs-primary" type="button" data-adm="msave">회의 참석자 저장</button></div>
    <h3 class="qs-sub">③ 명부 — 「개별 선정」 탭의 표시(직전선정·차기미신고·직전심사·심사·감리)에 쓰입니다</h3>
    <table class="qs-table"><thead><tr><th>명부</th><th>지금 자료</th><th>건수</th><th></th></tr></thead><tbody>${
      ['prev', 'screened', 'next', 'review'].map((k) => { const r = regs[k] || {}; return `<tr><td>${esc(r.label || k)}</td><td>${esc(r.name || '(없음)')} ${esc((r.date || '').slice(0, 10))}</td><td class="num">${r.total || 0}</td>
        <td>${r.ready ? `<button class="qs-link" type="button" data-adm="regview" data-k="${k}">보기</button> · ` : ''}<button class="qs-link" type="button" data-adm="reg" data-k="${k}" data-mode="append">자료 추가</button> · <button class="qs-link" type="button" data-adm="reg" data-k="${k}" data-mode="replace">바꾸기</button></td></tr>`; }).join('')}</tbody></table>
    <h3 class="qs-sub">④ 인뎁스 서식 — 「선정 회사 모두 받기」·「빈 서식」이 쓰는 파일</h3>
    <table class="qs-table"><thead><tr><th>서식</th><th>지금 파일</th><th></th></tr></thead><tbody>${
      (state.templates || []).map((t) => `<tr><td>${esc(t.label)}</td><td>${t.ready ? `${esc(t.name || '')} ${esc((t.date || '').slice(0, 10))}` : '(없음)'}</td>
        <td><label class="qs-link">교체<input type="file" accept=".xlsx,.xlsm" data-tpl-put="${t.kind}" hidden></label></td></tr>`).join('')}</tbody></table>`;
}

function short(f) { return f.short || String(f.firm).replace(/회계법인|\s+/g, '') || f.firm; }
function isoToday() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

/* 고른 회계법인 — 주요 정보 + 일정·인원 고치기(일정만, 인원만, 둘 다 가능) */
function adminEditHtml(f, adjusted) {
  return `<div class="adm-edit" id="admEdit">
    <div class="adm-edit-info"><div class="qs-firm-card">${firmFieldsHtml(f, null)}</div></div>
    <div class="adm-edit-form">
      <div class="adm-edit-title"><b>${esc(f.firm)}</b>${adjusted ? ' <span class="adm-key is-adj">조정됨</span>' : ''}</div>
      <label>시작일 <input class="qs-input" type="date" value="${esc(f.start || '')}" data-f="start"></label>
      <label>종료일 <input class="qs-input" type="date" value="${esc(f.end || '')}" data-f="end"></label>
      <label>팀장 <input class="qs-input" list="admStaff" value="${esc(f.lead || '')}" data-f="lead"></label>
      <label>팀원 <input class="qs-input" list="admStaff" value="${esc(f.member || '')}" data-f="member" title="품감 정규 인원이 아니면 비상근으로 봅니다"></label>
      <div class="adm-edit-btns"><button class="qs-btn qs-primary" type="button" data-adm="fsave">반영</button>${
        adjusted ? '<button class="qs-btn" type="button" data-adm="freset" title="일정 엑셀에 적힌 그대로">원래대로</button>' : ''}<button class="qs-btn" type="button" data-adm="fclose">닫기</button></div>
      <p class="qs-muted qs-small">바꾼 칸만 이력에 남습니다 — 일정만, 인원(팀장·팀원)만, 또는 둘 다.</p>
    </div></div>`;
}

async function onAdminClick(e) {
  const b = e.target.closest('[data-adm]');
  if (!b) return;
  const box = $('adminPanel');
  const act = b.dataset.adm;
  if (act === 'close') { setAdminMode(false); return; }
  if (act === 'reg') { state.regKind = b.dataset.k; state.regMode = b.dataset.mode; $('regFile').click(); return; }
  if (act === 'regview') { showRegister(b.dataset.k); return; }
  if (act === 'mprev' || act === 'mnext') {
    const months = eventMonths(state.adminFirms.filter((f) => f.start && f.end));
    const i = months.indexOf(state.admMonth) + (act === 'mnext' ? 1 : -1);
    if (months[i]) { state.admMonth = months[i]; renderAdmin(); }
    return;
  }
  if (act === 'pick') {
    const f = state.adminFirms[Number(b.dataset.fi)];
    state.admFirm = state.admFirm === f.firm ? '' : f.firm;
    await renderAdmin();
    const ed = $('admEdit');
    if (ed && ed.scrollIntoView) ed.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }
  if (act === 'fclose') { state.admFirm = ''; renderAdmin(); return; }
  if (act === 'fsave' || act === 'freset') {
    const firm = state.admFirm;
    try {
      let res;
      if (act === 'fsave') {
        const v = (k) => box.querySelector(`#admEdit [data-f="${k}"]`).value.trim();
        res = await api.put('/qc-sample/schedule/firm', { firm, start: v('start'), end: v('end'), lead: v('lead'), member: v('member') });
      } else {
        res = await api.del(`/qc-sample/schedule/firm?firm=${encodeURIComponent(firm)}`);
      }
      const kinds = ((res && res.changes) || []).map((c) => (c.kind === 'schedule' ? '일정' : '참여인원'));
      toast(kinds.length ? `${firm} ${kinds.join('·')}을(를) 바꿨습니다.` : '바뀐 것이 없습니다.');
      await loadSchedule();
      renderAdmin();
    } catch (err) { showAlert(err.message, { title: '관리자설정' }); }
    return;
  }
  if (act === 'madd') {
    box.querySelector('.adm-meet tbody').insertAdjacentHTML('beforeend', `<tr><td><input class="qs-input" type="date" data-m="day"></td><td><input class="qs-input" placeholder="예: 위탁위" data-m="word"></td>
      <td><input class="qs-input adm-wide" placeholder="예: 홍길동, 김철수" data-m="names"></td><td><button class="qs-link" type="button" data-adm="mdel">빼기</button></td></tr>`);
    return;
  }
  if (act === 'mdel') { b.closest('tr').remove(); return; }
  if (act === 'msave') {
    const rulesOut = {};
    for (const tr of box.querySelectorAll('.adm-meet tbody tr')) {
      const day = tr.querySelector('[data-m="day"]').value, word = tr.querySelector('[data-m="word"]').value.trim();
      const names = tr.querySelector('[data-m="names"]').value.split(/[,\s]+/).filter(Boolean);
      if (day && word && names.length) (rulesOut[day] = rulesOut[day] || {})[word] = names;
    }
    try {
      await api.put('/qc-sample/schedule/meetings', { rules: rulesOut });
      toast('회의 참석자를 저장했습니다.');
      await loadSchedule();
      renderAdmin();
    } catch (err) { showAlert(err.message, { title: '관리자설정' }); }
  }
}

/* 관리자 조정 이력(올해분) — 모든 사용자의 품감 일정 아래(사용자 지정 2026-10-15) */
function renderHistory() {
  const box = $('schedHistory');
  const h = (state.sched && state.sched.history) || [];
  box.hidden = !h.length;
  if (!h.length) return;
  box.innerHTML = `<div class="qs-card-head"><h2>일정·인원 변경 이력 <span class="qs-muted qs-small">${new Date().getFullYear()}년 · 일정 엑셀을 올린 뒤 관리자가 고친 것</span></h2></div>
    <ul class="qs-history">${[...h].reverse().map((x) => `<li>${esc(historyLine(x))}</li>`).join('')}</ul>`;
}

/* ── ⓪ 품감 일정(첫 화면) ── */

async function loadSchedule() {
  try {
    state.sched = await api.get('/qc-sample/schedule');
  } catch (e) { $('schedGrid').innerHTML = `<p class="qs-muted">${esc(e.message)}</p>`; return; }
  // 빨간 날(대한민국 공휴일 + 근로자날) — 일정이 있는 기간만큼(사용자 지정 2026-10-15)
  state.holidays = {};
  const months = state.sched.ready ? eventMonths(state.sched.events) : [];
  if (months.length) {
    try {
      state.holidays = await api.get(`/qc-sample/holidays?start=${monthWindow(months[0]).start}&end=${monthWindow(months[months.length - 1]).end}`);
    } catch { /* 휴일을 못 받아도 일정은 그린다 */ }
  }
  renderSchedule();
  renderHistory();
  if (state.data) showFirmBrief();      // 최근 자료를 일정보다 먼저 열었으면 요약 줄을 다시
}

function renderSchedule() {
  const sc = state.sched;
  /* 한 달 기준(사용자 지정 2026-10-14) — 일정이 있는 달만 ◀ ▶ 로 넘긴다. 처음은 이번 달(없으면 가까운 달). */
  const months = sc && sc.ready ? eventMonths(sc.events) : [];
  const nowYm = new Date().toISOString().slice(0, 7);
  if (!state.schedMonth || !months.includes(state.schedMonth)) {
    state.schedMonth = months.includes(nowYm) ? nowYm : (months.find((m) => m >= nowYm) || months[months.length - 1] || nowYm);
  }
  /* 이어진 가로 스크롤(사용자 지정 2026-10-15) — 일정이 있는 전체 기간을 한 표로, 이름 열은 고정.
     월 단추는 그 달 첫 주로 스크롤한다. 처음에는 이번 주가 보이는 자리. */
  const w = months.length ? { start: monthWindow(months[0]).start, end: monthWindow(months[months.length - 1]).end } : monthWindow(state.schedMonth);
  const weeks = weekdays(w.start, w.end);
  const mi = months.indexOf(state.schedMonth);
  $('schedRange').innerHTML = `<button class="qs-mbtn" type="button" data-month="${months[mi - 1] || ''}" ${mi > 0 ? '' : 'disabled'}>◀</button>
    ${months.map((m) => `<button class="qs-mbtn ${m === state.schedMonth ? 'on' : ''}" type="button" data-month="${m}">${+m.slice(5)}월</button>`).join('')}
    <button class="qs-mbtn" type="button" data-month="${months[mi + 1] || ''}" ${mi >= 0 && mi < months.length - 1 ? '' : 'disabled'}>▶</button>`;
  $('schedMeta').textContent = sc && sc.meta && sc.meta.name ? `${sc.meta.name} · ${String(sc.meta.date || '').slice(0, 10)}` : '';
  if (!sc || !sc.ready) {
    $('schedGrid').innerHTML = `<p class="qs-muted" style="padding:12px">아직 일정 엑셀을 올리지 않았습니다${state.admin ? ' — 위의 「일정 엑셀 올리기」' : ' — 관리자에게 요청해 주세요'}.</p>`;
    return;
  }
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  // 강조할 이름 — 서버가 아니라 이 브라우저에만 저장 + 로그인한 본인 이름은 늘 강조(사용자 지정 2026-10-15)
  const hl = new Set([...myHighlights(), (state.me && state.me.display_name) || ''].map((n) => String(n).replace(/\s/g, '')).filter(Boolean));
  const focus = new Set(state.firmFocus);
  // 이번 주(월~금)
  const mon = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const thisWeek = new Set([0, 1, 2, 3, 4].map((n) => iso(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + n))));
  const hol = state.holidays || {};
  const dayCls = (dIso) => `${dIso === todayIso ? 'is-today' : thisWeek.has(dIso) ? 'is-week' : ''}${hol[dIso] ? ' is-holiday' : ''}`;
  const seenMonth = new Set();
  const head1 = `<tr><th class="name" rowspan="2">이름</th>${weeks.map((wk) => `<th class="sep" rowspan="2"></th>${wk.map((d) => {
    const ym = d.iso.slice(0, 7);
    const first = !seenMonth.has(ym) && seenMonth.add(ym);
    return `<th class="day ${dayCls(d.iso)} ${first ? 'm-start' : ''}" ${first ? `data-ym="${ym}"` : ''} data-iso="${d.iso}">${d.md}</th>`;
  }).join('')}`).join('')}</tr>`;
  const head2 = `<tr>${weeks.map((wk) => wk.map((d) => `<th class="${dayCls(d.iso)}" ${hol[d.iso] ? `data-tip="${esc(hol[d.iso])}"` : ''}>${
    d.iso === todayIso ? '오늘' : hol[d.iso] ? `<span class="hol">${esc(hol[d.iso])}</span>` : d.wd}</th>`).join('')).join('')}</tr>`;
  // 「이번 주 · 다음 주 · 다다음 주」 단추(사용자 지정 2026-10-14·15): 그 주에 팀장·팀원으로 나가는 사람만, 회의 막대는 숨김
  const sel = state.weekOnly ? (state.weekOffset || 0) : null;
  const selStart = sel === null ? '' : weekMonday(sel);
  const selEnd = sel === null ? '' : weekMonday(sel, 4);
  const goers = new Set(sc.events.filter((e) => (e.kind === 'lead' || e.kind === 'member') && e.start <= selEnd && e.end >= selStart).map((e) => e.person));
  let people = state.rowsOnly ? sc.staff.filter((n) => state.rowsOnly.has(n)) : sc.staff;
  if (state.weekOnly) people = people.filter((n) => goers.has(n));
  const WEEK_NAMES = ['이번 주', '다음 주', '다다음 주'];
  $('schedFilterNote').textContent = state.weekOnly ? `· ${WEEK_NAMES[sel]} 품질관리감리 ${people.length}명` : state.rowsOnly ? `· 찾기: ${people.length}명만 표시` : '';
  $('schedAll').hidden = !state.rowsOnly;
  document.querySelectorAll('[data-week]').forEach((b) => b.classList.toggle('on', state.weekOnly && Number(b.dataset.week) === sel));
  const body = people.map((name) => {
    const evs = sc.events.filter((e) => e.person === name && e.end >= w.start && e.start <= w.end && !(state.weekOnly && e.kind === 'meeting'));
    const cells = weeks.map((wk) => {
      let i = 0;
      return `<td class="sep"></td>${weekCells(wk, evs).map((c) => {
        const days = wk.slice(i, i + c.span).map((d) => d.iso);
        i += c.span;
        const now = (days.includes(todayIso) ? 'is-today' : days.some((x) => thisWeek.has(x)) ? 'is-week' : '')
          + (c.span === 1 && hol[days[0]] ? ' is-holiday' : '');
        if (!c.ev) return `<td class="${now}"></td>`;
        // 마우스를 올리면 잘린 글자까지 다 보이게 — 막대 이름 전체를 맨 앞에
        const tip = [c.ev.label, c.ev.firm, c.ev.role && `${c.ev.role}${c.ev.with ? `(with ${c.ev.with})` : ''}`, `${c.ev.start} ~ ${c.ev.end}`].filter(Boolean).join(' · ')
          + (c.ev.mate ? `\n함께(비상근): ${mateText(c.ev.mate)}` : firmText(firmOf(c.ev.firm)));
        const five = (c.ev.days && c.ev.days.length ? c.ev.days.length : c.span) >= 5
          ? `is-5d ${days[0] > c.ev.start ? 'cont-l' : ''} ${days[days.length - 1] < c.ev.end ? 'cont-r' : ''}` : '';
        // 1일짜리(회의 등)는 평소 마우스 오버 없음 — 글자가 잘렸을 때만 이름을 띄운다(사용자 지정 2026-10-15, 아래 markClipped)
        const oneDay = c.ev.kind === 'meeting' || (c.ev.days && c.ev.days.length === 1);
        const hover = oneDay ? `data-tip="${esc(c.ev.label)}"` : `title="${esc(tip)} · ${c.ev.days && c.ev.days.length ? c.ev.days.length : c.span}일"`;
        return `<td colspan="${c.span}" class="ev ${c.ev.kind} ${five} ${c.ev.region ? 'is-region' : ''} ${now} ${c.ev.firm && focus.has(c.ev.firm) ? 'is-firm' : ''}" ${hover}><span>${esc(c.ev.label)}</span></td>`;
      }).join('')}`;
    }).join('');
    return `<tr class="${hl.has(String(name).replace(/\s/g, '')) ? 'is-hl' : ''}"><td class="name" title="${esc(name)}">${esc(name)}</td>${cells}</tr>`;
  }).join('');
  /* 「비상근」 줄(사용자 지정 2026-10-15) — 주마다 함께 나가는 비상근(정규 멤버 줄에 없는 사람)
     전체 보기: 인원만 「(3명)」 · 회계법인·이름으로 찾았을 때: 실제 이름(마우스 오버로 소속·연락처) */
  const searching = !!state.rowsOnly;
  const shownSet = new Set(people);
  const outsideRow = weeks.map((wk) => {
    const a = wk[0].iso, b = wk[wk.length - 1].iso;
    const mates = new Map();
    for (const e of sc.events) {
      if (!e.mate || !shownSet.has(e.person) || e.end < a || e.start > b) continue;
      if (searching && !state.nameSearch && state.firmFocus.length && !state.firmFocus.includes(e.firm)) continue;
      mates.set(e.mate.name, e.mate);
    }
    const list = [...mates.values()];
    const text = !list.length ? '' : searching ? list.map((m) => m.name).join(', ') : `(${list.length}명)`;
    const tip = list.map(mateText).join('\n');
    return `<td class="sep"></td><td colspan="${wk.length}" class="outside" title="${esc(tip)}">${esc(text)}</td>`;
  }).join('');
  const span = weeks.reduce((n, wk) => n + wk.length + 1, 1);
  const tail = `<tr class="outside-row"><td class="name">비상근</td>${outsideRow}</tr><tr class="spacer"><td colspan="${span}"></td></tr>`;
  const keepLeft = $('schedGrid').scrollLeft;
  $('schedGrid').innerHTML = `<table class="qs-sched"><thead>${head1}${head2}</thead><tbody>${body}${tail}</tbody></table>`;
  fitRows(people.length + 2);
  markClipped();
  // 처음엔 이번 달 첫날부터(사용자 지정 2026-10-15), 다시 그릴 때는 보던 자리 그대로
  if (state.schedScrolled) $('schedGrid').scrollLeft = keepLeft;
  else { scrollSchedTo(null, state.schedMonth); state.schedScrolled = true; }
}

/* 강조할 이름(이 브라우저에만) */
function myHighlights() {
  try { return JSON.parse(localStorage.getItem('qcSample:highlight') || '[]'); } catch { return []; }
}
function setMyHighlights(list) {
  try { localStorage.setItem('qcSample:highlight', JSON.stringify(list)); } catch { /* 저장이 안 되면 이번 화면에서만 */ }
}

/* n주 뒤 월요일(+plus 일) — YYYY-MM-DD */
function weekMonday(n = 0, plus = 0) {
  const t = new Date();
  const m = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7) + n * 7 + plus);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`;
}

/* 이번 주 월요일(YYYY-MM-DD) */
function thisMonday() {
  const t = new Date();
  const m = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7));
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`;
}

/* 글자가 잘린 1일짜리 칸(회의·휴일)에만 마우스 오버 이름 */
function markClipped() {
  $('schedGrid').querySelectorAll('[data-tip]').forEach((el) => {
    const inner = el.querySelector('span') || el;
    if (inner.scrollWidth > inner.clientWidth + 1) el.title = el.dataset.tip;
    else el.removeAttribute('title');
  });
}

/* 그 날짜(없으면 그 뒤 첫 날짜) 칸이 이름 열 바로 옆에 오게 가로 스크롤 */
function scrollSchedTo(iso, ym) {
  const wrap = $('schedGrid');
  const ths = [...wrap.querySelectorAll('th.day[data-iso]')];
  const th = ym ? wrap.querySelector(`th[data-ym="${ym}"]`) : (ths.find((t) => t.dataset.iso >= iso) || ths[ths.length - 1]);
  const name = wrap.querySelector('th.name');
  if (!th || !name) return;
  // 화면 좌표로 잰다 — 이름 열(고정) 바로 오른쪽에 그 날짜가 오게
  const delta = th.getBoundingClientRect().left - name.getBoundingClientRect().right;
  wrap.scrollLeft = Math.max(0, wrap.scrollLeft + delta - 1);
}

/* 행 높이 — 상하 스크롤이 생기지 않는 한도에서 넓게(25~34px, 사용자 지정 2026-10-14) */
function fitRows(n) {
  const wrap = $('schedGrid');
  const table = wrap.querySelector('.qs-sched');
  if (!table || !n) return;
  // 포털 틀은 내용만큼 늘어나므로 틀 높이가 아니라 **보이는 창** 높이로 잰다.
  let view = window.innerHeight || 800, top = wrap.getBoundingClientRect().top + window.scrollY;
  try {
    const fe = window.frameElement;
    if (fe && window.parent) { view = window.parent.innerHeight - Math.max(0, fe.getBoundingClientRect().top); }
  } catch { /* 다른 출처면 그냥 창 높이 */ }
  const avail = view - top - 28 - 8;                  // 8 = 가로 스크롤 막대
  // 인원 수·화면 높이에 맞추되 조금 넉넉하게(×1.08, 23~36px — 사용자 지정 2026-10-15). 표 안 세로 스크롤은 두지 않고,
  // 표 아래 간격은 카드 여백(css .qs-sched-card)으로 둔다.
  // 주·찾기로 몇 명만 보일 때는 낮게(28px 까지 — 사용자 지정 2026-10-15), 전체 명단일 때는 그대로
  const cap = state.rowsOnly || state.weekOnly ? 28 : 36;
  const rh = Math.max(23, Math.min(cap, Math.floor((avail / (n + 2)) * 1.08)));
  table.style.setProperty('--rh', `${rh}px`);
  fitCols(table);
}

/* 날짜 열 너비 — 이번(보고 있는) 달 한 달 치가 좌우 스크롤 없이 한 화면에 들어오게(사용자 지정 2026-10-15) */
function fitCols(table) {
  const wrap = $('schedGrid');
  const ym = state.schedMonth || new Date().toISOString().slice(0, 7);
  const days = table.querySelectorAll(`th.day[data-iso^="${ym}"]`).length || 22;
  const weeks = new Set([...table.querySelectorAll(`th.day[data-iso^="${ym}"]`)].map((t) => {
    const d = new Date(t.dataset.iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toDateString();
  })).size || 5;
  const nameW = (table.querySelector('th.name') || {}).offsetWidth || 86;
  // 한 달 치가 한눈에 「쏙」 — 화면을 꽉 채우지 않고 꽉 찬 폭보다 10% 좁게(사용자 지정 2026-10-15)
  const dw = Math.max(28, Math.min(58, Math.floor(((wrap.clientWidth - nameW - weeks * 6 - 4) / days) * 0.9)));
  table.style.setProperty('--dw', `${dw}px`);
}

/* 상근 직원끼리 나가는 회계법인 — 마우스를 올리면 주소·대표·외감 개수·사무소 수(사용자 지정 2026-10-14) */
const shortFirm = (v) => String(v || '').replace(/회계\s*법인|\(주\)|주식회사|\s/g, '');
function firmOf(name) {
  if (!name || !state.sched) return null;
  const k = shortFirm(name);
  return (state.sched.firms || []).find((f) => shortFirm(f.firm) === k || f.short === k) || null;
}
function firmText(f) {
  if (!f) return '';
  const parts = [f.office && `주사무소 ${shortAddr(f.office)}`, f.ceo && `대표 ${f.ceo}`, f.audits != null && f.audits !== '' && `외감 ${f.audits}개`,
    f.branches != null && f.branches !== '' && `사무소(분실 포함) ${f.branches}`, f.members != null && f.members !== '' && `구성원 ${f.members}명`].filter(Boolean);
  return parts.length ? `\n${parts.join(' · ')}` : '';
}

/* 비상근 위원 한 줄 — 「신한회계법인 김정은 회계사 · 010-… · …@…」(없는 정보는 뺀다) */
function mateText(m) {
  const org = m.org ? (/회계법인|감사반/.test(m.org) ? m.org : `${m.org}회계법인`) : '';
  return [[org, `${m.name}${org ? ' 회계사' : ''}`].filter(Boolean).join(' '), m.phone, m.email].filter(Boolean).join(' · ');
}

const FIRM_FIELDS = [
  ['start', '시작일'], ['end', '종료일'], ['lead', '팀장'], ['member', '팀원'], ['reason', '선정사유'],
  ['reviews', '개별선정 개수'], ['founded', '설립'], ['audits', '외감 개수'], ['@review', '최근 감리이력'],
  ['office', '주사무소'], ['members', '구성원 수'], ['branches', '사무소(분실 포함)'], ['region', '구분'], ['ceo', '대표'], ['fiscal', '결산월'],
];

/* 회계법인 카드(사용자 지정 2026-10-15)
   · 시작·종료일에 요일 — 대부분과 다른 시작 요일, 대부분과 다른 일수(예: 다들 4일·목요일 종료인데 5일·금요일 종료)는 굵은 파랑
   · 외감 개수 100개 초과는 파랑 · 「최근 감리이력: 2023 / (이력없음)」(과거 감리이력·최근 감리를 하나로) · 결산월은 3월이 아닐 때만
   · 사무소(분실 포함): 본점과 다른 지역 분사무소가 있으면 「2 (부산 분점1 포함)」으로 적고 강조(DART 일반현황) */
const mode = (arr) => { const c = new Map(); arr.forEach((x) => c.set(x, (c.get(x) || 0) + 1)); return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; };
const wdOf = (iso) => (iso ? '일월화수목금토'[new Date(iso).getDay()] : '');
const daysOf = (f) => (f.start && f.end ? Math.round((new Date(f.end) - new Date(f.start)) / 86400000) + 1 : null);
const cityOf = (addr) => String(addr || '').trim().split(/\s+/)[0].replace(/(특별|광역|특별자치)?시$|도$/, '').replace(/^경기$/, '경기') || '';

function firmFieldsHtml(f, dart) {
  const firms = (state.sched && state.sched.firms) || [];
  const startW = mode(firms.map((x) => wdOf(x.start)).filter(Boolean));
  const dur = mode(firms.map(daysOf).filter(Boolean));
  const val = (k) => {
    if (k === 'office' && f.office) return esc(shortAddr(f.office));      // 서울특별시 → 서울시 …
    if (k === 'start' || k === 'end') {
      if (!f[k]) return null;
      const odd = k === 'start' ? wdOf(f.start) !== startW : daysOf(f) !== dur;
      const txt = `${f[k]}(${wdOf(f[k])})${k === 'end' && daysOf(f) ? ` · ${daysOf(f)}일` : ''}`;
      return odd ? `<span class="em-blue">${esc(txt)}</span>` : esc(txt);
    }
    if (k === 'reviews') {   // 대부분(예: 3개)과 다른 개수는 굵은 파랑
      if (f.reviews == null || f.reviews === '') return null;
      const usual = mode(firms.map((x) => Number(x.reviews)).filter((n) => Number.isFinite(n)));
      return Number(f.reviews) !== usual ? `<span class="em-blue">${esc(f.reviews)}</span>` : esc(f.reviews);
    }
    if (k === 'audits') return f.audits == null || f.audits === '' ? null : Number(f.audits) > 100 ? `<span class="em-blue">${esc(f.audits)}</span>` : esc(f.audits);
    if (k === '@review') { const r = lastReview(f); return esc(r === '없음' ? '(이력없음)' : r); }
    if (k === 'fiscal') return f.fiscal && !/^3\s*월/.test(String(f.fiscal)) ? `<span class="em-blue">${esc(f.fiscal)}</span>` : null;
    if (k === 'branches') {
      if (f.branches == null || f.branches === '') return null;
      if (!dart || !dart.branches || dart.branches === '없음') return esc(f.branches);
      const head = cityOf(dart.head_office || f.office);
      const cnt = new Map();
      for (const part of String(dart.branches).split(/\s*,\s*/)) {
        const city = part.replace(/\(.*\)$/, '').trim();
        if (city && city !== head) cnt.set(city, (cnt.get(city) || 0) + 1);
      }
      if (!cnt.size) return esc(f.branches);
      const note = [...cnt.entries()].map(([c, n]) => `${c} 분점${n}`).join(', ');
      return `<span class="em-blue">${esc(f.branches)}</span> <small class="em-note">(${esc(note)} 포함)</small>`;
    }
    const v = f[k];
    return v === undefined || v === null || v === '' ? null : esc(v);
  };
  return FIRM_FIELDS.map(([k, l]) => { const v = val(k); return v === null ? '' : `<div><b>${l}:</b> <span class="fv">${v}</span></div>`; }).join('');
}

function findFirm() {
  const q = $('schedQ').value.trim();
  const sc = state.sched;
  const box = $('firmInfo');
  state.weekOnly = false;          // 찾기와 「이번 주」 거르기가 겹치면 찾은 사람이 안 보였다(사용자 지적 2026-10-15)
  setTimeout(scrollToFound, 0);
  if (!q || !sc || !sc.ready) { state.firmFocus = []; state.rowsOnly = null; state.nameSearch = false; box.hidden = true; renderSchedule(); return; }
  // 여러 개는 쉼표·띄어쓰기로(사용자 지정 2026-10-15) — 낱말마다 회계법인·이름을 찾아 합친다
  // 「회계법인 나루」·「나루 회계법인」은 한 낱말로 붙이고, 「회계법인」·「회계」·「법인」만 있는 낱말은 버린다(모두 회계법인이라 — 사용자 지정 2026-10-15)
  const terms = searchTerms(q);
  const hits = [...new Map(terms.flatMap((t) => firmMatch(sc.firms, t)).map((f) => [f.firm, f])).values()];
  const everyone = [...new Set([...sc.staff, ...sc.firms.flatMap((f) => [f.lead, f.member])].filter(Boolean))];
  const names = new Set(terms.flatMap((t) => everyone.filter((n) => String(n).replace(/\s/g, '').includes(t))));
  box.hidden = false;
  state.firmFocus = hits.map((f) => f.firm);
  state.nameSearch = names.size > 0;
  const joined = new Set([...names].filter((n) => sc.staff.includes(n)));
  sc.events.filter((e) => e.firm && state.firmFocus.includes(e.firm)).forEach((e) => joined.add(e.person));
  hits.forEach((f) => [f.lead, f.member].forEach((n) => { if (n && sc.staff.includes(n)) joined.add(n); }));
  state.rowsOnly = names.size || hits.length ? joined : null;
  renderSchedule();
  let html = '';
  if (names.size) {
    const rows = [];
    for (const n of names) {
      for (const e of sc.events.filter((x) => x.person === n)) {
        const what = e.firm || e.label;
        if (!rows.some((r) => r.who === n && r.what === what && r.start === e.start)) rows.push({ who: n, what, role: e.role || '회의', mate: e.with || '', start: e.start, end: e.end, region: e.region });
      }
      for (const f of sc.firms.filter((x) => x.lead === n || x.member === n)) {
        if (!rows.some((r) => r.who === n && r.what.replace(/\s/g, '') === String(f.firm).replace(/\s/g, ''))) rows.push({ who: n, what: f.firm, role: f.lead === n ? '팀장' : '팀원', mate: f.lead === n ? f.member : f.lead, start: f.start, end: f.end });
      }
    }
    rows.sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(a.who).localeCompare(String(b.who), 'ko'));
    const many = names.size > 1;
    html += `<div class="qs-card-head"><h2>${esc([...names].join(', '))}</h2><span class="qs-muted">참여 내역 ${rows.length}건(전체 기간)</span></div>
      <table class="qs-joined"><thead><tr><th>기간</th>${many ? '<th>이름</th>' : ''}<th>회계법인·일정</th><th>역할</th><th>함께</th></tr></thead><tbody>${
      rows.map((r) => `<tr class="${r.end && String(r.end) < new Date().toISOString().slice(0, 10) ? 'is-past' : ''}"><td>${esc(r.start || '')} ~ ${esc(r.end || '')}</td>${
        many ? `<td>${esc(r.who)}</td>` : ''}<td>${esc(r.what)}${r.region ? ` _${esc(r.region)}` : ''}</td><td class="my-role">${esc(r.role)}</td><td>${esc(r.mate || '')}</td></tr>`).join('')}</tbody></table>`;
  }
  if (hits.length) {
    html += (html ? '<hr>' : '') + hits.map((f) => `<div class="qs-card-head"><h2>${esc(f.firm)}</h2>
      <span class="qs-muted">${esc(f.start || '')} ~ ${esc(f.end || '')} · 팀장 ${esc(f.lead || '-')} · 팀원 ${esc(f.member || '-')}${
        f.member_info ? ` (${esc(mateText(f.member_info))})` : ''}${f.lead_info ? ` · 팀장 ${esc(mateText(f.lead_info))}` : ''}</span>
      <span class="qs-grow"></span><button class="qs-btn" type="button" data-dart="${esc(f.short || f.firm)}">DART 사업보고서 요약</button></div>
      <div class="qs-firm-card" data-firm-card="${esc(f.firm)}">${firmFieldsHtml(f, null)}</div><div data-dart-out></div>`).join('<hr>');
  }
  if (!html) {
    html = `<div class="qs-card-head"><h2>${esc(q)}</h2><span class="qs-muted">감리일정·배정에 없는 회계법인·이름입니다.</span>
      <span class="qs-grow"></span><button class="qs-btn" type="button" data-dart="${esc(terms[0])}">DART 사업보고서 요약</button></div><div data-dart-out></div>`;
  }
  box.innerHTML = html;
  // 분사무소 지역은 DART 일반현황에서 — 받으면 카드를 다시 그린다
  for (const f of hits) {
    firmGeneral(f).then((g) => {
      const card = [...box.querySelectorAll('[data-firm-card]')].find((x) => x.dataset.firmCard === f.firm);
      if (g && card) card.innerHTML = firmFieldsHtml(f, g);
    });
  }
}

/* 찾은 사람(회계법인)의 가장 가까운 다음 일정이 있는 주로 스크롤 — 없으면 마지막 일정 */
function scrollToFound() {
  const sc = state.sched;
  if (!sc || !state.rowsOnly) return;
  const today = new Date().toISOString().slice(0, 10);
  const evs = sc.events.filter((e) => state.rowsOnly.has(e.person) && (!state.firmFocus.length || state.firmFocus.includes(e.firm)))
    .sort((a, b) => a.start.localeCompare(b.start));
  const ev = evs.find((e) => e.end >= today) || evs[evs.length - 1];
  if (!ev) return;
  const d = new Date(ev.start);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  scrollSchedTo(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}

/* 회계법인사업보고서 요약 — [품감] 법인 조회가 쓰는 /qc API 그대로(최신 보고서) */
async function dartSummary(button) {
  const out = button.closest('.qs-card').querySelector('[data-dart-out]');
  await busy(button, '읽는 중…', async () => {
    try {
      const firms = await api.get(`/qc/firms?q=${encodeURIComponent(button.dataset.dart)}`);
      const f = (firms.items || [])[0];
      if (!f) throw new Error('전자공시에서 그 회계법인을 찾지 못했습니다.');
      const reps = await api.get(`/qc/firms/${f.corp_code}/reports`);
      const rep = reps.items[0];
      const p = await api.get(`/qc/reports/${rep.rcept_no}/profile?corp_code=${f.corp_code}`);
      const ac = p.audit_counts || {};
      const pair = (x) => (x ? `${x[0] ?? '-'} (전기 ${x[1] ?? '-'})` : '-');
      out.innerHTML = `<div class="qs-firm-card" style="margin-top:8px">
        <div><b>보고서</b>${esc(rep.report_nm)}</div>
        <div><b>외감 개별 합계</b>${pair((ac.indi || {}).total)}</div>
        <div><b>사업보고서 제출대상</b>${pair((ac.indi || {}).issuer)}</div>
        <div><b>연결 합계</b>${pair((ac.con || {}).total)}</div>
        <div><b>인원 합계</b>${esc(((p.staff || {}).total || [])[0] ?? '-')}</div>
      </div>`;
    } catch (e) { out.innerHTML = `<p class="msg err">${esc(e.message)}</p>`; }
  });
}

/* 알림창을 **지금 보이는 자리**에(사용자 지정 2026-10-14) — 이 화면은 포털 틀 안에서 내용 높이만큼 늘어나 있어
   공용 알림창(ui/dialog.js 의 .kd-mask, 틀 전체를 덮고 가운데 정렬)이 한참 아래에 떴다. 공용 파일은 다른 화면도 쓰므로
   여기서만, 알림창이 붙을 때 덮개를 보이는 띠 높이로 줄여 옮긴다. */
function keepDialogsInView() {
  // ⚠️ 알림창이 뜨는 순간에는 틀이 아직 짧았다가 곧바로 포털이 내용 높이만큼 늘린다(그때 덮개가 같이 늘어나
  //    알림창이 다시 아래로 밀렸다, 사용자 지적 2026-10-15). 그래서 「틀이 길 때만」을 따지지 않고 늘 보이는 띠에 맞추고,
  //    틀 크기가 바뀌거나(resize) 바깥 페이지를 굴릴 때(scroll)도 다시 맞춘다.
  const place = (mask) => {
    try {
      const fe = window.frameElement;
      if (!fe || !window.parent) return;
      const r = fe.getBoundingClientRect();
      const ph = window.parent.innerHeight;
      const vt = Math.max(0, -r.top), vh = Math.min(ph, r.bottom) - Math.max(0, r.top);
      if (vh <= 0) return;
      Object.assign(mask.style, { top: `${vt}px`, bottom: 'auto', height: `${vh}px` });
    } catch { /* 다른 출처면 그대로 */ }
  };
  const all = () => document.querySelectorAll('.kd-mask').forEach(place);
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      const mask = n.classList.contains('kd-mask') ? n : n.querySelector?.('.kd-mask');
      if (mask) { place(mask); requestAnimationFrame(() => place(mask)); }
    }
  }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', all);
  try { window.parent.addEventListener('scroll', all, { passive: true, capture: true }); } catch { /* 다른 출처 */ }
}

/* ── 시작 ── */

async function start() {
  keepDialogsInView();
  try { state.me = await auth.me(); } catch { document.body.insertAdjacentHTML('afterbegin', '<div class="qs-warn">로그인이 필요합니다. 포털에서 다시 열어 주세요.</div>'); return; }
  state.admin = (state.me.roles || []).includes('admin');
  if (api.askPass) {   // GitHub(정적) 사이트 — 보기는 암호 없이, 서식·일정·명부 올리기만 관리자 확인(구글 이메일 + 관리자 암호, 2026-10-16)
    const b = document.createElement('button'); b.type = 'button'; b.className = 'qs-tab qs-pass'; b.textContent = state.admin ? '관리자(로그인됨)' : '관리자';
    b.title = '서식·감리일정·명부를 올리거나 바꿀 때만 관리자 구글 이메일과 관리자 암호로 확인합니다 — 이 브라우저에 기억합니다';
    b.addEventListener('click', async () => { await api.askPass(); location.reload(); });
    document.querySelector('.qs-tabs').append(b);
  }
  document.querySelectorAll('.qs-tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('pickFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadPresubmit(f); e.target.value = ''; });
  $('recentSel').addEventListener('change', onRecentChange);
  $('pickSave').addEventListener('click', savePicks);
  $('pickDel').addEventListener('click', deletePicks);
  briefHover();
  $('pickName').addEventListener('click', (e) => { if (e.target.closest('.firm-link')) openFirmReport(); });
  recentOpen().then(() => renderRecent());      // 최근 조회한 자료를 바로(이 컴퓨터에 있으면)
  $('slicers').addEventListener('click', onSlicerClick);
  $('slicerAdd').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === '__all' || v === '__few') { state.slicerAll = v === '__all'; renderSlicers(); return; }
    if (v) { state.slicers.push(v); renderSlicers(); }
  });
  $('slicerReset').addEventListener('click', () => { state.picked = {}; renderSlicers(); });
  $('resetAll').addEventListener('click', resetAll);
  $('statusCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('statusTable').dataset.tsv || ''); toast('선정현황을 복사했습니다 — 한글·엑셀에 붙여 넣으세요.'); } catch { showAlert('복사하지 못했습니다.', { title: '선정현황' }); }
  });
  $('hitTable').addEventListener('change', onHitCheck);
  $('hitTable').addEventListener('click', (e) => {
    const b = e.target.closest('[data-why]');
    if (b) { showWhy(b); return; }
    const th = e.target.closest('th[data-sort]');
    if (th) {      // 오름 → 내림 → 원래 차례
      const k = th.dataset.sort, cur = state.hitSort;
      state.hitSort = !cur || cur.k !== k ? { k, dir: 1 } : cur.dir > 0 ? { k, dir: -1 } : null;
      renderHits();
    }
  });
  $('pickedList').addEventListener('click', onPickedClick);
  $('pickedList').addEventListener('change', onPickedChange);
  $('getAll').addEventListener('click', getAll);
  for (const id of ['optKind', 'optLead', 'optMember', 'optSchedule']) {
    const v = store.get(id);
    if (v) $(id).value = v;
    $(id).addEventListener('change', () => { store.set(id, $(id).value); autoSavePicks(); });
  }
  const drop = $('drop');
  drop.addEventListener('click', () => $('reconFiles').click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('reconFiles').click(); } });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); addReconFiles([...e.dataTransfer.files]); });
  $('reconFiles').addEventListener('change', (e) => { addReconFiles([...e.target.files]); e.target.value = ''; });
  $('reconList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (b) { state.recon.files.splice(Number(b.dataset.rm), 1); renderReconList(); }
  });
  $('reconRun').addEventListener('click', runRecon);
  for (const id of ['reconOut', 'otherOut']) {
    $(id).addEventListener('click', (e) => { const a = e.target.closest('[data-co]'); if (a) { e.preventDefault(); openReportByName(a.dataset.co); } });
  }
  $('firmFind').addEventListener('click', firmFind);
  $('firmQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') firmFind(); });
  $('firmSel').addEventListener('change', firmReports);
  $('firmRun').addEventListener('click', firmRun);
  loadTemplates();
  // ⓪ 품감 일정
  $('schedAdmin').hidden = !state.admin;      // 일정 엑셀 올리기만 관리자 — 강조할 이름은 누구나(이 브라우저에만)
  $('schedFind').addEventListener('click', findFirm);
  $('adminOpen').addEventListener('click', () => setAdminMode(!state.adminMode));
  $('adminPanel').addEventListener('click', onAdminClick);
  $('adminPanel').addEventListener('change', (e) => { const inp = e.target.closest('[data-tpl-put]'); if (inp) putTemplate(inp); });
  $('tplBox').addEventListener('click', (e) => { if (e.target.closest('[data-tpl-get]')) getBlankTemplate(); });
  $('schedAll').addEventListener('click', () => { $('schedQ').value = ''; findFirm(); });
  // 「오늘」: 찾기·이번 주 거르기를 모두 풀어 전체 사람을 보이고, 오늘이 든 이번 주 월~금으로
  $('schedToday').addEventListener('click', () => {
    $('schedQ').value = '';
    state.firmFocus = []; state.rowsOnly = null; state.weekOnly = false; state.nameSearch = false;
    $('firmInfo').hidden = true;
    renderSchedule();
    scrollSchedTo(thisMonday());
  });
  // 초기화 — 찾기·주 거르기를 풀고 처음 화면(이번 달 첫날부터, 전체 명단)으로
  $('schedReset').addEventListener('click', () => {
    $('schedQ').value = '';
    state.firmFocus = []; state.rowsOnly = null; state.weekOnly = false; state.nameSearch = false;
    $('firmInfo').hidden = true;
    state.schedMonth = new Date().toISOString().slice(0, 7);
    state.schedScrolled = false;
    renderSchedule();
  });
  // 이번 주 · 다음 주 · 다다음 주 — 켜진 단추를 다시 누르면 끈다
  document.querySelectorAll('[data-week]').forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.week);
    const off = state.weekOnly && (state.weekOffset || 0) === n;
    state.weekOnly = !off;
    state.weekOffset = n;
    renderSchedule();
    if (state.weekOnly) scrollSchedTo(weekMonday(n));   // 그 주 월~금이 다 보이게
  }));
  $('schedRange').addEventListener('click', (e) => {
    const b = e.target.closest('[data-month]');
    if (!b || !b.dataset.month) return;
    state.schedMonth = b.dataset.month;
    $('schedRange').querySelectorAll('.qs-mbtn[data-month]').forEach((x) => x.classList.toggle('on', x.dataset.month === state.schedMonth && /월$/.test(x.textContent)));
    scrollSchedTo(null, state.schedMonth);
  });
  // 스크롤하면 보이는 달로 단추 불을 옮긴다
  $('schedGrid').addEventListener('scroll', () => {
    const wrap = $('schedGrid');
    const edge = (wrap.querySelector('th.name') || wrap).getBoundingClientRect().right;
    const ths = [...wrap.querySelectorAll('th[data-ym]')];
    const cur = ths.filter((t) => t.getBoundingClientRect().left <= edge + 8).pop();
    if (cur && cur.dataset.ym !== state.schedMonth) {
      state.schedMonth = cur.dataset.ym;
      $('schedRange').querySelectorAll('.qs-mbtn[data-month]').forEach((x) => x.classList.toggle('on', x.dataset.month === state.schedMonth && /월$/.test(x.textContent)));
    }
  }, { passive: true });
  $('schedQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') findFirm(); });
  $('firmInfo').addEventListener('click', (e) => { const b = e.target.closest('[data-dart]'); if (b) dartSummary(b); });
  $('schedFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    try { const r = await api.upload('/qc-sample/schedule', fd); toast(`일정을 올렸습니다 — ${r.staff}명 · 막대 ${r.events}개 · 회계법인 ${r.firms}곳`); loadSchedule(); }
    catch (err) { showAlert(err.message, { title: '일정 엑셀' }); }
  });
  $('schedHl').addEventListener('click', async () => {
    const v = await showPrompt('강조할 이름(여러 명이면 쉼표(,)로 구분) - 본인 컴퓨터에만 저장되며, 본인은 늘 강조됩니다.',
      { title: '강조할 이름', value: myHighlights().join(', ') });
    if (v === null || v === undefined) return;
    setMyHighlights(String(v).split(/[,\s]+/).filter(Boolean));
    renderSchedule();
  });
  // ④ 기타 대사
  const od = $('otherDrop');
  od.addEventListener('click', () => $('otherFiles').click());
  od.addEventListener('dragover', (e) => { e.preventDefault(); od.classList.add('is-over'); });
  od.addEventListener('dragleave', () => od.classList.remove('is-over'));
  const addOther = (list) => { for (const f of list) if (state.other.files.length < 20 && !state.other.files.some((x) => x.name === f.name && x.size === f.size)) state.other.files.push(f); renderOtherList(); };
  od.addEventListener('drop', (e) => { e.preventDefault(); od.classList.remove('is-over'); addOther([...e.dataTransfer.files]); });
  $('otherFiles').addEventListener('change', (e) => { addOther([...e.target.files]); e.target.value = ''; });
  $('otherList').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { state.other.files.splice(Number(b.dataset.rm), 1); renderOtherList(); } });
  $('otherPreFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { state.other.pre = f; renderOtherList(); } });
  $('otherRun').addEventListener('click', runOther);
  // 명부
  $('regPrev').addEventListener('click', () => showRegister('prev'));
  $('regNext').addEventListener('click', () => showRegister('next'));
  $('regReview').addEventListener('click', () => showRegister('review'));
  $('regScreened').addEventListener('click', () => showRegister('screened'));
  $('regFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) uploadRegister(f); });
  $('firmName').addEventListener('change', async () => { await loadRegisters(); if (state.data) renderSlicers(); showFirmBrief(); });
  loadSchedule();
  window.addEventListener('resize', () => { const n = $('schedGrid').querySelectorAll('tbody tr').length; fitRows(n); markClipped(); });
}

start();
