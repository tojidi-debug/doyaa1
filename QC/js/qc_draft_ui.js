/* [품감] 심의안 초안 작성 화면 — 개발 화면(qc_dev.html)만 (2026-10-08 개편)
 *   왼쪽: [조직 부분] / [개별 부문] 탭 — **상위 묶음만** 고른다(감사조서 작성·관리절차 …, 위반 혐의, 법규위반 차감, 직전 비교)
 *   오른쪽: 위에 고정 단추줄(한 줄) [심의안 초안(미리보기)] [평가표 체크] [평가표(엑셀)다운] [심의안 초안(hwpx)] [강평(초안)down] [파일로 저장] [파일 불러오기] [초기화] — 이 PC 작업은 3개월 자동 저장·자동 이어짐 + 점수
 *           그 아래 본문 = 평가표 체크(처음 화면) · 미리보기 · 고른 묶음의 세부 항목 편집
 *   평가표 체크: 조직 10항목 × 미설계·미운영/일부미흡/지적없음, 개별 17항목 × 점검회사 열(회사 수만큼, 2·3·4…) — 바꾸면 조직·개별 쪽에 그대로, 점수는 자동
 * 체크 상태는 회계법인마다 이 PC(localStorage)에 남는다. 엔진은 frontend/qc/qc_draft.js(QcDraft), 문안은 frontend/qc/qc_phrases.json.
 */
import { $, esc } from './lookup_kit.js';

const Q = () => window.QcDraft;
const CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const ORG_CLS = ['미지적', '일부미흡', '미운영', '미설계'];   /* 미설계는 드물어 맨 아래(사용자 지정 2026-10-08) */
const KEY = (code) => `qc.draft.${code}`;
const clip = (s, n = 22) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
const f1 = (n) => (Math.round(n * 100) / 100).toFixed(2);

let ctx = null;        // { state, phrases, toast, showConfirm, showAlert, api, downloadDraft(model), downloadEval(model, sel), describe }
let sel = null;        // 체크 상태
let tab = 'org';
let view = 'check';    // check | preview | org:<그룹키> | law | deduct | indi:<부문> | iviol | prior
let saveTimer = null;
const folds = { law: true, iviol: true };   /* 왼쪽 위반 혐의 체크 목록 — 처음엔 접힘, [▸/▾] 로 펴고 접음(사용자 지정 2026-10-08) */

const defaults = () => ({ org: { items: {}, law: {}, viol: {}, reason: '' }, indi: { K: 3, companies: ['', '', ''], items: {}, viol: {}, prior: {}, year: '' } });
function load(code) {
  try { const v = JSON.parse(localStorage.getItem(KEY(code)) || 'null'); if (v && v.org && v.indi) return v; } catch { /* */ }
  return defaults();
}
/* 회계법인마다 이 PC(localStorage)에 자동 저장 — 3개월(90일) 동안 남기고, 그 법인을 조회해 초안 작성을 열면 자동으로 이어진다(사용자 지정 2026-10-08) */
const KEEP_DAYS = 90;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const p = ctx.state.profile;
    sel._meta = { corp_code: p.corp_code, firm: p.corp_name, report: p.report_nm || '', saved: Date.now() };
    try { localStorage.setItem(KEY(p.corp_code), JSON.stringify(sel)); } catch { /* */ }
  }, 150);
}
const summary = (v) => {
  const o = Object.values((v.org || {}).items || {}).filter(x => x && x.cls && x.cls !== '미지적').length;
  const i = Object.values((v.indi || {}).items || {}).filter(x => (x.marks || []).some(Boolean) || (x.picks || []).length || Object.values(x.subs || {}).some(a => (a || []).some(n => Number(n) > 0))).length;
  return { o, i };
};
/* 최근 작업(90일 안) — 새것부터. 90일이 지난 것은 지운다(열 때마다) */
export function recentWorks(now = Date.now()) {
  const out = [];
  let ls; try { ls = localStorage; } catch { return out; }
  for (let n = ls.length - 1; n >= 0; n--) {
    const k = ls.key(n); if (!k || !k.startsWith('qc.draft.')) continue;
    let v = null; try { v = JSON.parse(ls.getItem(k) || 'null'); } catch { /* */ }
    if (!v || !v.org || !v.indi) continue;
    const m = v._meta || {};
    if (m.saved && now - m.saved > KEEP_DAYS * 864e5) { try { ls.removeItem(k); } catch { /* */ } continue; }
    const sm = summary(v); if (!sm.o && !sm.i) continue;
    out.push({ code: k.slice('qc.draft.'.length), firm: m.firm || k.slice('qc.draft.'.length), report: m.report || '', saved: m.saved || 0, ...sm });
  }
  return out.sort((a, b) => b.saved - a.saved);
}
const when = (t) => { if (!t) return '날짜 모름'; const d = new Date(t); const z = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}.${z(d.getMonth() + 1)}.${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };
const K = () => Math.max(0, Number(sel.indi.K) || 0);
function syncCompanies() {
  const k = K(); const cs = sel.indi.companies || []; while (cs.length < k) cs.push(''); cs.length = k; sel.indi.companies = cs;
  for (const it of Object.values(sel.indi.items)) {
    for (const f of (it.picks || [])) { f.cos = (f.cos || []).slice(0, k); while (f.cos.length < k) f.cos.push(false); }
    if (it.marks) { it.marks = it.marks.slice(0, k); while (it.marks.length < k) it.marks.push(0); }
    if (it.subs) for (const sk of Object.keys(it.subs)) { const a2 = (it.subs[sk] || []).slice(0, k); while (a2.length < k) a2.push(0); it.subs[sk] = a2; }
  }
}

/* ── 열기/닫기 ── */
let unloadHooked = false;
export function openDraft(c) {
  if (!unloadHooked && typeof window !== 'undefined') {   /* 페이지를 떠날 때(포털의 다른 메뉴 등) — 브라우저 기본 확인창만 띄울 수 있다 */
    unloadHooked = true;
    window.addEventListener('beforeunload', (e) => { try { const m = isOpen() && missingPicks(); if (m && (m.indi.length || m.org.length)) { e.preventDefault(); e.returnValue = '체크되지 않은 항목(들)이 있습니다. 확인필요'; } } catch { /* */ } });
  }
  ctx = c; const prev = recentWorks().find(r => r.code === c.state.profile.corp_code);   /* 90일 지난 작업 정리 + 이 법인의 마지막 작업 */
  sel = load(c.state.profile.corp_code); syncCompanies(); view = 'check';
  if (prev) c.toast(`마지막 작업(${when(prev.saved)} · 조직 ${prev.o} · 개별 ${prev.i})을 이어서 불러왔습니다.`);   /* 자동 불러오기(사용자 지정 2026-10-08) */
  const cat = document.querySelector('.catalog'); cat.dataset.mode = 'draft';
  let panel = $('draftPanel'); if (!panel) { panel = document.createElement('div'); panel.id = 'draftPanel'; cat.prepend(panel); }
  panel.hidden = false;
  const det = $('detail'); det.dataset.draft = '1';
  let main = $('draftMain'); if (!main) { main = document.createElement('div'); main.id = 'draftMain'; det.prepend(main); }
  main.hidden = false;
  render(); wire(panel); wire(main);
  if (panel.scrollIntoView) panel.scrollIntoView({ block: 'start' });
}
export function closeDraft() {
  const cat = document.querySelector('.catalog'); delete cat.dataset.mode;
  const panel = $('draftPanel'); if (panel) panel.hidden = true;
  const main = $('draftMain'); if (main) main.hidden = true;
  delete $('detail').dataset.draft;
}
export function isOpen() { const p = $('draftPanel'); return !!(p && !p.hidden); }
export function currentModel() { return Q().model(ctx.phrases, sel, K()); }
export function currentSel() { return sel; }

/* ── 그리기 ── */
function render() { const m = currentModel(); renderLeft(m); renderMain(m); }

function badge(cls, text) { return `<span class="dr-type ${cls}">${esc(text)}</span>`; }
function renderLeft(m) {
  const p = ctx.state.profile; const ph = ctx.phrases;
  const item = (v, title, b) => `<button type="button" class="dr-nav ${view === v ? 'on' : ''}" data-view="${esc(v)}"><span class="t">${esc(title)}</span>${b}</button>`;
  let list = '';
  if (tab === 'org') {
    list += ph.org.groups.map(g => { const mg = m.org.groups.find(x => x.key === g.key); return item(`org:${g.key}`, g.title, mg ? badge(mg.type, mg.typeLabel) : badge('none', '지적 없음')); }).join('');
    list += item('law', '법규 위반 혐의', m.viol.law.length ? badge('미운영', `${m.viol.law.length}건`) : badge('none', '없음')) + leftChecks('law');
    list += item('deduct', '법규위반 차감·판단이유', m.score.deduct ? badge('미운영', `−${m.score.deduct}`) : badge('none', '없음'));
  } else {
    /* 회사별 탭(사용자 지정 2026-10-08) — 한 회사씩 감사계획 수립부터 그룹재무제표 감사절차까지 끝낸다 */
    list += sel.indi.companies.map((c, ci) => { const n = coItemCount(m, ci); const miss = missingPicks().indi.filter(x => x.ci === ci).length; return item(`co:${ci}`, `${c || `회사${ci + 1}`}${(sel.indi.small || [])[ci] ? ' (소규모)' : ''}`, (n ? badge('일부미흡', `${n}개 항목`) : badge('none', '지적 없음')) + (miss ? badge('need', `미선택 ${miss}`) : '')); }).join('');
    list += item('iviol', '위반 혐의(GAAP·GAAS)', m.viol.gaap || m.viol.gaas ? badge('미운영', [m.viol.gaap ? 'GAAP' : '', m.viol.gaas ? 'GAAS' : ''].filter(Boolean).join('·')) : badge('none', '없음')) + leftChecks('iviol');
    list += item('prior', '직전 감리와 비교표', m.indi.prior.companies ? badge('none', `${m.indi.prior.rate}% → ${m.indi.rate}%`) : badge('none', '직전 값 없음'));
  }
  $('draftPanel').innerHTML = `
    <div class="dr-head"><button type="button" id="drBack" class="recon-back">← 회계법인 찾기</button><b>심의안 초안 작성</b><span class="dr-firm">${esc(p.corp_name)}</span></div>
    <div class="dr-tabs"><button type="button" class="dr-tab ${tab === 'org' ? 'on' : ''}" data-tab="org">조직 부분(품질관리절차)</button><button type="button" class="dr-tab ${tab === 'indi' ? 'on' : ''}" data-tab="indi">개별 부문(개별감사업무)</button></div>
    <div class="dr-navs">${list}</div>
    <p class="dr-hint">묶음을 고르면 오른쪽에 세부 항목이 나옵니다. 오른쪽 위 [평가표 체크]에서 항목마다 한 번에 표시할 수도 있습니다.</p>`;
}

/* 왼쪽 메뉴에서 바로 체크(사용자 지정 2026-10-08) — 고르면 법규위반 차감이 바로 바뀐다 */
function lawOptions() { const law = (ctx.phrases.viol && ctx.phrases.viol.law) || { items: [] }; return law.items.map(it => ({ key: it.key, label: it.free ? '기타(자유기재)' : it.title, on: !!(sel.org.law[it.key] || {}).on })); }
function iviolOptions() { const vs = sel.indi.viol || {}; return [{ key: 'gaap', label: '회계처리기준(GAAP) 위반 혐의', on: !!(vs.gaap || {}).on }, { key: 'gaas', label: '회계감사기준(GAAS) 위반 혐의', on: !!(vs.gaas || {}).on }]; }
function leftChecks(id) {
  const opts = id === 'law' ? lawOptions() : iviolOptions(); const n = opts.filter(o => o.on).length;
  const toggle = `<button type="button" class="dr-fold" data-fold="${id}" title="체크 목록 ${folds[id] ? '펴기' : '접기'}">${folds[id] ? '▸' : '▾'} 위반 사항 체크${n ? ` (${n})` : ''}</button>`;
  if (folds[id]) return `<div class="dr-navchk folded">${toggle}</div>`;
  return `<div class="dr-navchk">${toggle}${opts.map(o => `<label><input type="checkbox" data-ms="${id}" value="${esc(o.key)}" ${o.on ? 'checked' : ''}>${esc(o.label)}</label>`).join('')}</div>`;
}
function renderMain(m) {
  const main = $('draftMain'); if (!main) return;
  const bar = `<div class="dr-bar">
      <div class="dr-bar-btns">
        <button type="button" data-view="preview" class="${view === 'preview' ? 'on' : ''}">심의안 초안(미리보기)</button>
        <button type="button" data-view="check" class="${view === 'check' ? 'on' : ''}">평가표 체크</button>
        <button type="button" id="drXlsx">평가표(엑셀)다운</button>
        <button type="button" id="drPdf" class="teal-line" title="내려받을 심의안 초안(hwpx)을 그대로 PDF로 바꿔 미리 봅니다 — 내려받기 전 확인용">심의안(미리보기)</button>
        <button type="button" id="drHwpx" class="teal" title="체크한 항목으로 심의안 초안(hwpx)을 내려받습니다 — 일부만 작성돼 있어도 그 상태로">심의안 초안(hwpx)</button>
        <button type="button" id="drGang" class="navy" title="체크한 지적사항으로 감사인감리 결과 강평자료 초안(hwpx) — 개선방향·이행보고 제출문서·감리 지적사례 포함">강평(초안)down</button>
        <span class="sep"></span>
        <button type="button" id="drSave" title="지금 탭(${tab === 'org' ? '조직' : '개별'})의 체크·작성 내용을 파일(.json)로 저장합니다 — 다른 담당자에게 보내 합치거나 다른 PC에서 이어 쓸 때만(이 PC에는 자동 저장)">파일로 저장</button>
        <button type="button" id="drLoad" title="다른 담당자가 [파일로 저장]으로 보낸 파일(.json)을 골라 이 화면에 합칩니다(예: 조직 담당 + 개별 담당)">파일 불러오기</button>
        <button type="button" id="drReset" class="danger" title="이 회계법인의 체크 상태를 모두 지웁니다">초기화</button>
      </div>
      <div class="dr-score">점수 <b>${m.score.total.toFixed(1)}</b> (조직 ${m.score.org.toFixed(1)}/60 · 개별 ${m.score.indi.toFixed(1)}/40${m.score.deduct ? ` · 차감 −${m.score.deduct}` : ''}) → <b class="lv ${m.score.level}">${m.score.level}</b></div>
    </div>`;
  let body = '';
  if (view === 'check') body = checkHtml(m);
  else if (view === 'preview') body = previewHtml(m);
  else if (view.startsWith('org:')) body = orgGroupHtml(view.slice(4), m);
  else if (view === 'law') body = lawHtml(m);
  else if (view === 'deduct') body = deductHtml(m);
  else if (view.startsWith('indi:')) body = coHtml(0, m);
  else if (view.startsWith('co:')) body = coHtml(Math.min(Number(view.slice(3)) || 0, K() - 1), m);
  else if (view === 'iviol') body = iviolHtml(m);
  else if (view === 'prior') body = priorHtml(m);
  main.innerHTML = bar + `<div class="dr-body">${body}</div>`;
}

/* 앞뒤가 맞지 않는 분류 — 막지 않고 알린다(사용자 지정 2026-10-08):
 *   모니터링 ① 사후심리 관련 정책과 절차가 미설계·미운영이면 ② 사후심리결과에 대한 관리는 일부미흡·지적없음일 수 없다 */
function orgWarnings() {
  const c = (k) => (sel.org.items[k] || {}).cls || '미지적';
  const out = [];
  if (['미운영', '미설계'].includes(c('d1')) && ['일부미흡', '미지적'].includes(c('d2'))) out.push(`모니터링(사후심리): ① 사후심리 관련 정책과 절차가 미운영인데 ② 사후심리결과에 대한 관리가 「${c('d2') === '미지적' ? '지적없음' : '일부미흡'}」입니다 — ①이 미운영이면 ②도 미운영이어야 합니다. 확인해 주세요.`);
  return out;
}
const warnBox = () => { const w = orgWarnings(); return w.length ? `<div class="qc-check dr-warn"><b>확인 필요</b><ul>${w.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''; };
let lastWarn = '';
function notifyWarnings() { const w = orgWarnings().join('\n'); if (w && w !== lastWarn) ctx.toast(w); lastWarn = w; }

/* ── 평가표 체크(처음 화면) ── */
function companiesHtml() {
  const k = K(); const cos = sel.indi.companies;
  return `<div class="dr-cos"><label>점검회사 수 <select data-f="K">${[2, 3, 4, 5, 6].map(n => `<option value="${n}" ${n === k ? 'selected' : ''}>${n}개사</option>`).join('')}${[2, 3, 4, 5, 6].includes(k) ? '' : `<option value="${k}" selected>${k}개사</option>`}</select></label>
    <label>직접 입력 <input type="number" data-f="Kn" min="1" max="20" value="${k}" style="width:56px"></label>
    <div class="dr-conames">${cos.map((c, i) => `<input type="text" data-co="${i}" placeholder="회사 ${i + 1}" value="${esc(c)}">`).join('')}</div></div>`;
}
function checkHtml(m) {
  const ph = ctx.phrases; const s = m.score; const k = K(); const cos = sel.indi.companies;
  // 조직
  const orgRows = ph.org.groups.map(g => g.items.map((it, i) => {
    const cls = (sel.org.items[it.key] || {}).cls || '미지적'; const sc = s.orgItems.find(x => x.key === it.key) || { w: 0, pts: 0 };
    const r = (val, on) => `<td class="ck"><input type="radio" name="ck_${it.key}" data-ck="${it.key}" value="${val}" ${on ? 'checked' : ''}>${val === '미운영' && cls === '미설계' ? '<small class="misul">(미설계)</small>' : ''}</td>`;
    return `<tr class="${it.important ? 'imp-row' : ''}" data-row="${it.key}">${i === 0 ? `<td class="lab" rowspan="${g.items.length}">${esc(g.title)}</td>` : ''}<td class="l">${CIRC[i]} ${it.important ? `<span class="imp">${esc(it.title)}</span><sup class="star" title="중요절차">★</sup>` : esc(it.title)}</td>${r('미운영', cls === '미운영' || cls === '미설계')}${r('일부미흡', cls === '일부미흡')}${r('미지적', cls === '미지적')}<td class="num">${f1(sc.w)}</td><td class="num">${f1(sc.pts)}</td></tr>`;
  }).join('')).join('');
  // 개별 — 평가표 엑셀과 같은 줄: ②는 「식별과 평가」·「대응」 두 하위 줄의 합, ⑮는 하위 5줄의 합(사용자 지정 2026-10-08)
  const NO = (key) => { const n = Number(key.slice(1)); return CIRC[(n <= 1 ? n : n <= 3 ? 2 : n - 1) - 1]; };
  const scoreCells = (sk) => { const sc = s.indiItems.find(x => x.key === sk) || { avg: 0, w: 0, pts: 0 }; return `<td class="num">${f1(sc.avg)}</td><td class="num">${f1(sc.w)}</td><td class="num">${f1(sc.pts)}</td>`; };
  const blank3 = '<td class="sub-blank" colspan="3"></td>';
  const picksOf = (it) => { const st = sel.indi.items[it.key] || {}; return Q().indiCounts(it, { indi: { items: { [it.key]: { ...st, marks: [], subs: null } } } }, k).perCo; };
  const checkCells = (it) => { const st = sel.indi.items[it.key] || {}; const marks = st.marks || []; const pp = picksOf(it);
    return cos.map((_, ci) => { const on = (Number(marks[ci]) || 0) > 0 || pp[ci] > 0; return `<td class="ck"><input type="checkbox" data-mk="${it.key}" data-i="${ci}" ${on ? 'checked' : ''} ${pp[ci] ? 'title="회사 탭에서 지적 문안을 고른 회사입니다 — 끄면 그 지적도 지웁니다"' : ''}></td>`; }).join(''); };
  const sumCells = (vals) => vals.map(v => `<td class="num sumc">${v ? v : '-'}</td>`).join('');
  const rowsFor = (it, first, part, span) => {
    const head = first ? `<td class="lab" rowspan="${span}">${esc(part)}</td>` : '';
    const title = it.title.replace(/\s*미흡\s*$/, '');
    if (it.key === 'i2') {
      const i3 = ph.indi.items.find(x => x.key === 'i3');
      const sum = cos.map((_, ci) => (Q().indiCounts(it, sel, k).perCo[ci] || 0) + (Q().indiCounts(i3, sel, k).perCo[ci] || 0));
      return `<tr class="parent" data-row="i2">${head}<td class="l">${NO('i2')} 중요한 왜곡표시위험의 식별과 평가절차/평가된 왜곡표시위험 관련 대응절차</td>${sumCells(sum)}${scoreCells('i23')}</tr>
        <tr class="subrow"><td class="l sub">1. ${esc(title)}</td>${checkCells(it)}${blank3}</tr>
        <tr class="subrow" data-row="i3"><td class="l sub">2. ${esc(i3.title.replace(/\s*미흡\s*$/, ''))}</td>${checkCells(i3)}${blank3}</tr>`;
    }
    if (it.key === 'i3') return '';
    if (Q().SUBS[it.key]) {   // ⑩·⑮ — 하위 줄 체크, 상위 줄은 합
      const st = sel.indi.items[it.key] || {}; const subs = st.subs || {};
      const tot = Q().indiCounts(it, sel, k).perCo;
      const subRows = Q().SUBS[it.key].map(([sk, label], si) => `<tr class="subrow"><td class="l sub">${si + 1}. ${esc(label)}</td>${cos.map((_, ci) => `<td class="ck"><input type="checkbox" data-sub="${it.key}:${sk}" data-i="${ci}" ${(Number((subs[sk] || [])[ci]) || 0) > 0 ? 'checked' : ''}></td>`).join('')}${blank3}</tr>`).join('');
      const coN = tot.filter(n => n > 0).length;   /* 평가표는 회사별 하위 지적의 합, 심의안 건수는 회사 수(한 회사에 여럿이어도 1) — 사용자 지정 2026-10-08 */
      return `<tr class="parent" data-row="${it.key}">${head}<td class="l">${NO(it.key)} ${esc(title)}${coN ? ` <small class="co-cnt" title="심의안 「개별감사업무 관련 지적사항」 건수는 회사 기준">심의안 건수 ${coN}개사</small>` : ''}</td>${sumCells(tot)}${scoreCells(it.key)}</tr>${subRows}`;
    }
    return `<tr data-row="${it.key}">${head}<td class="l">${NO(it.key)} ${esc(title)}</td>${checkCells(it)}${scoreCells(it.key)}</tr>`;
  };
  const indiRows = ph.indi.parts.map(part => {
    const its = ph.indi.items.filter(i => i.part === part);
    const span = its.reduce((a, it) => a + (it.key === 'i2' ? 3 : it.key === 'i3' ? 0 : Q().SUBS[it.key] ? 1 + Q().SUBS[it.key].length : 1), 0);
    return its.map((it, i) => rowsFor(it, i === 0, part, span)).join('');
  }).join('');
  const colHeads = cos.map((c, i) => `<th>${esc(c || `회사${i + 1}`)}</th>`).join('');
  return `${warnBox()}<div class="qc-sec"><span>평가표 체크 — 품질관리절차(60점)</span><span class="unit">미운영 0 · 일부미흡 ½ · 지적없음 전부</span></div>
    <table class="qc dr-check"><thead><tr><th>구성요소</th><th>주요 점검 항목</th><th>미운영</th><th>일부미흡</th><th>지적없음</th><th>배점</th><th>점수</th></tr></thead>
      <tbody>${orgRows}<tr><td class="lab sum" colspan="6">품질관리절차 관련 점수</td><td class="num sum"><b>${f1(s.org)}</b></td></tr></tbody></table>
    <div class="qc-sec"><span>평가표 체크 — 개별감사업무(40점)</span><span class="unit">회사마다 지적 있으면 체크 · ②·⑩·⑮ 는 아래 하위 줄의 합 · 점수 = 배점 × (1 − 평균지적개수)</span></div>
    ${companiesHtml()}
    <table class="qc dr-check"><thead><tr><th>구성요소</th><th>주요 점검 항목</th>${colHeads}<th>평균지적개수</th><th>배점</th><th>점수</th></tr></thead>
      <tbody>${indiRows}<tr><td class="lab sum" colspan="${2 + k + 2}">개별감사업무 관련 점수</td><td class="num sum"><b>${f1(s.indi)}</b></td></tr></tbody></table>
    <table class="qc dr-check dr-total"><tbody>
      <tr><td class="lab">법규위반 차감</td><td class="num">${s.deduct ? '−' + s.deduct : '-'}</td><td class="lab">품질관리점수 합계</td><td class="num"><b>${f1(s.total)}</b></td><td class="lab">품질관리수준</td><td><b class="lv ${s.level}">${s.level}</b></td></tr>
    </tbody></table>
    <p class="dr-hint">여기서 바꾼 것은 왼쪽 조직 묶음·개별 회사 탭에 그대로 반영되고, 회사 탭에서 바꾼 것도 여기에 바로 반영됩니다(서로 연동). 세부 문안은 왼쪽 묶음·회사를 눌러 고릅니다. 양호 90점 이상 · 보통 50점 이상 · 미흡 50점 미만.</p>`;
}

/* ── 세부 항목(오른쪽) ── */
function orgGroupHtml(gkey, m) {
  const g = ctx.phrases.org.groups.find(x => x.key === gkey); if (!g) return '';
  const mg = m.org.groups.find(x => x.key === g.key); let no = 0;
  const items = g.items.map(it => {
    const st = sel.org.items[it.key] || {}; const cls = st.cls || '미지적'; const flagged = cls !== '미지적';
    const exCls = cls === '미설계' ? '미운영' : cls; const examples = flagged ? (it.examples[exCls] || []) : [];   /* 미설계 예시는 서식에 없어 미운영 예시를 보여 준다 */
    const num = flagged ? CIRC[no++] + ' ' : '';
    return `<div class="dr-item ${flagged ? 'on' : ''}" data-key="${it.key}">
      <div class="dr-row"><span class="dr-title">${num}${it.important ? `<span class="imp">${esc(it.title)}</span>` : esc(it.title)}${flagged ? ` <b>${esc(Q().CLS_SUFFIX[cls])}</b>` : ''}${st.repeat && flagged ? '<b>*2</b>' : ''}${it.important ? '<sup class="star" title="중요절차 — 미운영(미설계)이면 묶음 전체가 미운영(미설계)">★</sup>' : ''}</span>
        <select data-f="cls" title="분류 — 평가표 체크와 같은 값(바꾸면 양쪽에 바로 반영)">${ORG_CLS.map(c => `<option value="${c}" ${c === cls ? 'selected' : ''}>${c === '미지적' ? '지적없음' : c}</option>`).join('')}</select>
        ${flagged ? `<label class="dr-chk" title="직전 감사인 감리시 지적되어 개선권고한 사항(표에 *2)"><input type="checkbox" data-f="repeat" ${st.repeat ? 'checked' : ''}>직전 감리 반복(*2)</label>` : ''}</div>
      ${flagged ? `<select class="dr-ex" data-f="ex" title="표준문안 예시 — 고르면 아래 칸에 전체 문안이 들어가고 고쳐 쓸 수 있습니다"><option value="etc">기타(자유기재)</option>${examples.map((e, i) => `<option value="${i}" ${st.ex === i ? 'selected' : ''}>${esc(clip(e, 150))}</option>`).join('')}</select>` : ''}
      ${flagged ? `<textarea data-f="text" rows="3" placeholder="◦ 감사인은 … (인터뷰·점검 결과에 맞게 고쳐 쓰세요)">${esc(st.text || '')}</textarea>
      ${therHtml(it, st, g)}` : ''}
    </div>`;
  }).join('');
  return `${g.key === 'd' ? warnBox() : ''}<div class="qc-sec"><span>${esc(g.title)}</span>${mg ? badge(mg.type, mg.typeLabel) : badge('none', '지적 없음')}</div><div class="dr-grp">${items}</div>
    <p class="dr-hint">★ 중요절차에 미운영이 있으면 이 묶음은 「미운영」, 아니면 「설계․운영상 일부 미흡」.</p>`;
}

/* 「□ 따라서」 하나 고르기 + 고쳐 쓰기 + 관련 규정·기준 문단(사용자 지정 2026-10-08) */
function therHtml(it, st, g) {
  const list = it.therefore || [];
  const at = Q().autoTher(it, st);
  const cur = Number.isInteger(st.ther) ? st.ther : at.i;
  const auto = !Number.isInteger(st.ther) && !st.therText;
  const chosen = st.therText || list[cur] || '';
  return `<div class="dr-ther"><div class="dr-ther-h">□ 따라서 (하나만)${auto && list.length > 1 ? (at.by === 'pair' ? ' <span class="autotag" title="과거 심의안에서 이 지적 문안과 함께 쓰인 따라서를 골랐습니다 — 바꿀 수 있습니다">자동 선택 · 과거 사례</span>' : ' <span class="autotag" title="고른 지적 문안과 가장 비슷한 것을 자동으로 골랐습니다 — 바꿀 수 있습니다">자동 선택</span>') : ''}</div>
      ${list.map((t, i) => `<label><input type="radio" name="ther_${it.key}" data-f="ther" data-i="${i}" ${!st.therText && i === cur ? 'checked' : ''}>${esc(t)}</label>`).join('')}
      <textarea data-f="therText" rows="2" placeholder="따라서 감사인은 … (고쳐 쓰면 이 글이 들어갑니다)">${esc(chosen)}</textarea>
    </div>
    <div class="dr-ref"><b>관련 규정</b> ${esc((g.rules || []).map(r => r.replace(/^\d+\.\s*/, '')).join(' · ') || '-')}
      <details><summary>기준 문단 보기</summary><p>□ ${esc(g.basis || '')}</p></details></div>`;
}
/* 여러 개를 고르는 드롭다운(사용자 지정 2026-10-08) */
function multiSelect(id, label, options, chosen) {
  const names = options.filter(o => chosen.includes(o.key)).map(o => o.label);
  return `<details class="msel" data-msel="${id}"><summary>${esc(label)}: <b>${names.length ? esc(names.join(', ')) : '선택 없음'}</b><span class="cnt">${names.length ? `(${names.length})` : ''}</span></summary>
    <div class="msel-list">${options.map(o => `<label><input type="checkbox" data-ms="${id}" value="${esc(o.key)}" ${chosen.includes(o.key) ? 'checked' : ''}>${esc(o.label)}</label>`).join('')}</div></details>`;
}
function violCtl(st, row) {
  const n = Math.max(1, Number(st.n) || 1);
  return `<label class="dr-chk" title="위반자 수 — 위반자별 5점 차감">위반자 <input type="number" data-f="n" min="1" max="50" value="${n}" style="width:50px">명</label>
    <label class="dr-chk" title="손해배상준비금 미적립처럼 품질관리제도의 영향이 없는 사항은 위반점수에 반영하지 않습니다"><input type="checkbox" data-f="noqc" ${st.noqc ? 'checked' : ''}>품질관리제도 영향 없음(차감 제외)</label>
    <span class="dr-rule">평가표 「${esc(row)}」 −${st.noqc ? 0 : n * Q().VIOL_PTS}점</span>`;
}
function lawHtml() {
  const law = (ctx.phrases.viol && ctx.phrases.viol.law) || { items: [] };
  const opts = law.items.map(it => ({ key: it.key, label: it.free ? '기타(자유기재)' : it.title }));
  const chosen = law.items.filter(it => (sel.org.law[it.key] || {}).on).map(it => it.key);
  const eds = law.items.filter(it => chosen.includes(it.key)).map(it => { const st = sel.org.law[it.key] || {};
    return `<div class="dr-item law on" data-law="${it.key}"><div class="dr-row"><span class="dr-title">${it.free ? '기타(자유기재)' : esc(it.title)}</span>${it.free ? `<input type="text" data-f="title" placeholder="제목(예: ○○ 위반)" value="${esc(st.title || '')}">` : ''}${violCtl(st, Q().LAW_ROW[it.key] || '기타')}</div>
      <textarea data-f="text" rows="3" placeholder="${esc(it.example || '위반 내용')}">${esc(st.text || '')}</textarea></div>`; }).join('');
  return `<div class="qc-sec"><span>법규 위반 혐의(품질관리제도 점검과정)</span></div>
    ${multiSelect('law', '위반 사항', opts, chosen)}
    <div class="dr-grp">${eds || '<p class="dr-hint">고른 것이 없으면 초안에 이 문단과 처리안의 ※ 줄이 들어가지 않습니다.</p>'}</div>
    <p class="dr-hint">예시 문구는 입력칸에 연한 글씨로 보이고, 쓴 글이 우선합니다.</p>`;
}
function deductHtml(m) {
  const rows = m.score.violRows; const any = rows.some(r => r.manual);
  return `<div class="qc-sec"><span>법규위반 차감(평가표)</span>${m.score.deduct ? badge('미운영', `−${m.score.deduct}`) : badge('none', '없음')}</div>
    <table class="dr-viol"><tr><th>구분</th><th>건수(위반자)</th><th>차감점수</th><th>차감 계</th><th>자동값</th></tr>${rows.map(r => `<tr data-vo="${esc(r.row)}" class="${r.manual ? 'manual' : ''}"><td>${esc(r.row)}</td>
        <td><input type="number" min="0" data-f="von" value="${r.n || ''}" placeholder="0"></td>
        <td><input type="number" min="0" data-f="vop" value="${r.n || r.manual ? r.pts : ''}" placeholder="${Q().VIOL_PTS}"></td>
        <td class="num">${r.sum ? '−' + r.sum : '-'}</td><td class="num auto">${r.auto ? `${r.auto}명 × ${Q().VIOL_PTS}` : '-'}${r.manual ? ' <span class="mtag">고침</span>' : ''}</td></tr>`).join('')}
      <tr><td><b>법규 위반 계</b></td><td class="num"><b>${rows.reduce((a2, r) => a2 + r.n, 0) || '-'}</b></td><td></td><td class="num"><b>${m.score.deduct ? '−' + m.score.deduct : '-'}</b></td><td></td></tr></table>
    ${any ? '<button type="button" id="drVoReset" class="dr-mini">자동값으로 되돌리기</button>' : ''}
    <p class="dr-hint">*법규위반 점수 산정요령: 위반자별 5점 차감(예: 미등기이사의 감사업무 수행, 위반자 2명·감사보고서 10개 → 10점 차감 = 2 × 5). 손해배상준비금 미적립처럼 품질관리제도의 영향이 없는 사항은 반영하지 않습니다.<br>
      건수·차감점수는 왼쪽에서 체크한 위반 혐의와 위반자 수로 자동으로 채워지고, 여기서 고쳐 쓸 수 있습니다(고친 줄은 「고침」). 분사무소 통제 미비·기타는 「기타」 줄.</p>
    <label class="dr-lab">최종 수준평가 판단이유(평가표)</label><textarea class="dr-reason" data-f="reason" rows="4" placeholder="감사인 특성, 질적 고려 요소(직전 지적사항의 개선정도 등)">${esc(sel.org.reason || '')}</textarea>`;
}
/* 「미흡」인데 지적 문안을 하나도 고르지 않은 칸(사용자 지정 2026-10-08) — 회사 탭·왼쪽 목록·내려받기 직전에 알린다.
 * ⑰ 은 평가표 하위 줄만으로도 표준 지적이 채워지므로 뺀다. 조직은 분류를 골랐는데 지적 문안이 빈 항목 */
function missingPicks() {
  const out = []; const k = K(); const cos = sel.indi.companies;
  for (const it of ctx.phrases.indi.items) {
    const c = Q().indiCounts(it, sel, k);
    for (let ci = 0; ci < k; ci++) {
      if (!coHas(it, ci)) continue;
      const mine = c.co[ci] || { f: [], etc: '' };
      if (mine.f.length || mine.etc) continue;
      if (it.key === 'i17' && c.rows.some(r => r.cos[ci])) continue;
      out.push({ ci, key: it.key, who: cos[ci] || `회사${ci + 1}`, title: it.title.replace(/\s*미흡\s*$/, '') });
    }
  }
  const org = [];
  for (const g of ctx.phrases.org.groups) for (const it of g.items) { const st = sel.org.items[it.key] || {}; if (st.cls && st.cls !== '미지적' && !String(st.text || '').trim()) org.push({ key: it.key, title: it.title, group: g.title }); }
  return { indi: out, org };
}
function missingText() {
  const m = missingPicks(); const lines = [];
  for (const x of m.org) lines.push(`조직 · ${x.group} — ${x.title}: 지적 문안이 비어 있음`);
  const by = {}; for (const x of m.indi) (by[x.who] = by[x.who] || []).push(x.title);
  for (const [who, ts] of Object.entries(by)) lines.push(`개별 · ${who} — ${ts.join(', ')}: 지적 문안 미선택`);
  return lines;
}
/* 다른 화면으로 옮기기 전 확인(사용자 지정 2026-10-08) — 지금 화면(회사 탭·조직 묶음)에 「미흡인데 문안 미선택」이 있으면
 * 「체크되지 않은 항목(들)이 있습니다. 확인필요」 안내창(닫기·ESC) → 닫으면 그 자리로 이동해 표시. 같은 상태로 한 번 더 옮기면 그대로 간다 */
let lastNag = '';
function viewMissing(v) {
  const m = missingPicks();
  if (v.startsWith('co:')) { const ci = Number(v.slice(3)) || 0; return m.indi.filter(x => x.ci === ci).map(x => ({ sel: `[data-ikey="${x.key}"]`, label: x.title })); }
  if (v === 'check') {   /* 평가표 체크 — 체크했는데 조직·개별에서 상세를 고르지 않은 줄 전부 */
    const out = []; const seen = new Set();
    for (const x of m.org) out.push({ sel: `tr[data-row="${x.key}"]`, label: `조직 · ${x.title}` });
    for (const x of m.indi) { const k = `${x.key}|${x.who}`; if (seen.has(k)) continue; seen.add(k); out.push({ sel: `tr[data-row="${x.key}"]`, label: `${x.who} · ${x.title}` }); }
    return out;
  }
  if (v.startsWith('org:')) { const g = ctx.phrases.org.groups.find(x => x.key === v.slice(4)); if (!g) return []; return m.org.filter(x => g.items.some(i => i.key === x.key)).map(x => ({ sel: `[data-key="${x.key}"]`, label: x.title })); }
  return [];
}
function nagBox(list) {
  return new Promise((resolve) => {
    document.querySelectorAll('.qc-nag').forEach(x => x.remove());
    const ov = document.createElement('div'); ov.className = 'qc-nag';
    ov.innerHTML = `<div class="box" role="alertdialog" aria-modal="true"><b>체크되지 않은 항목(들)이 있습니다. 확인필요</b><ul>${list.map(x => `<li>${esc(x.label)}</li>`).join('')}</ul><div class="btns"><button type="button" data-close>닫기</button></div></div>`;
    const done = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); resolve(); };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(); } };
    ov.querySelector('[data-close]').onclick = done; ov.addEventListener('click', (e) => { if (e.target === ov) done(); });
    document.addEventListener('keydown', onKey, true); document.body.append(ov); ov.querySelector('[data-close]').focus();
  });
}
function showMissing(list) {
  const main = $('draftMain'); if (!main) return;
  main.querySelectorAll('.flash-need').forEach(x => x.classList.remove('flash-need'));
  const els = list.map(x => main.querySelector(x.sel)).filter(Boolean);
  els.forEach(el => el.classList.add('flash-need'));
  if (els[0]) { if (els[0].scrollIntoView) els[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); const f = els[0].querySelector('input[data-f="cf"], input[data-f="cg"], textarea, select'); if (f && f.focus) f.focus({ preventScroll: true }); }
  setTimeout(() => els.forEach(el => el.classList.remove('flash-need')), 4000);
}
/* 옮기기 전에 부른다 — 막히면 false */
function guardLeave() {
  const list = viewMissing(view); if (!list.length) { lastNag = ''; return true; }
  const sig = view + '|' + list.map(x => x.sel).join(',');
  if (sig === lastNag) { lastNag = ''; return true; }
  lastNag = sig; nagBox(list).then(() => showMissing(list));
  return false;
}
/* ⑩ 처럼 지적이 많은 항목은 상위 계정 묶음을 먼저 체크 → 그 묶음의 세부 지적만 보인다(사용자 지정 2026-10-08) */
function grpOn(it, mine) {
  const on = new Set(mine.g || []);
  for (const g of it.groups || []) if (g.texts.some(t => mine.f.includes(t))) on.add(g.name);
  return on;
}
function shown(it, mine, text) {
  if (!it.groups) return true;
  if (mine.f.includes(text)) return true;
  const on = grpOn(it, mine);
  return it.groups.some(g => on.has(g.name) && g.texts.includes(text));
}
function grpHtml(it, mine) {
  if (!it.groups) return '';
  const on = grpOn(it, mine);
  return `<div class="co-grps"><span class="co-grps-h">관련 계정</span>${it.groups.map(g => `<label class="chip ${on.has(g.name) ? 'on' : ''}"><input type="checkbox" data-f="cg" data-g="${esc(g.name)}" ${on.has(g.name) ? 'checked' : ''}>${esc(g.name)}</label>`).join('')}</div>${on.size ? '' : '<p class="dr-hint co-grps-n">관련 계정을 먼저 체크하면 그 계정의 지적 문안이 나옵니다.</p>'}`;
}
/* 회사 하나의 개별 항목 — 지적 있는지(평가표 체크·하위 줄·고른 지적) */
function coHas(it, ci) {
  const st = sel.indi.items[it.key] || {}; const c = Q().indiCounts(it, sel, K());
  return (c.perCo[ci] || 0) > 0 || (Number((st.marks || [])[ci]) || 0) > 0;
}
function coItemCount(m, ci) { return ctx.phrases.indi.items.filter(it => coHas(it, ci)).length; }
/* 회사별 탭(사용자 지정 2026-10-08): 부문 차례대로 모든 항목 — 미지적은 연한 회색, [미흡]으로 바꾸면 평가표 체크에도 바로 반영되고
 * 과거 조치 문구(지적 예시)가 보인다. 지적을 고르면 위 「관련 규정」(기준서 문단)은 모든 회사의 지적을 함께 덮는 판으로 자동 */
function coHtml(ci, m) {
  const ph = ctx.phrases; const cos = sel.indi.companies; const name = cos[ci] || `회사${ci + 1}`; const small = !!(sel.indi.small || [])[ci];
  const tabs = cos.map((c, i) => `<button type="button" class="co-tab ${i === ci ? 'on' : ''}" data-view="co:${i}">${esc(c || `회사${i + 1}`)}${coItemCount(m, i) ? ` <small>${coItemCount(m, i)}</small>` : ''}</button>`).join('');
  const NO = (key) => { const n = Number(key.slice(1)); return CIRC[(n <= 1 ? n : n <= 3 ? 2 : n - 1) - 1]; };
  const parts = ph.indi.parts.map(part => {
    const rows = ph.indi.items.filter(i => i.part === part).map(it => {
      const st = sel.indi.items[it.key] || {}; const c = Q().indiCounts(it, sel, K()); const has = coHas(it, ci);
      const mine = { ...(c.co[ci] || { f: [], etc: '' }), g: (((st.co || {})[ci]) || {}).g || [] };   /* 상위 계정 묶음(g)은 화면 상태라 엔진 결과에 없다 */ const base = it.title.replace(/\s*미흡\s*$/, '');
      const sub = it.key === 'i2' ? '②-1 ' : it.key === 'i3' ? '②-2 ' : '';
      const head = `<div class="dr-row"><span class="dr-title">${sub || NO(it.key) + ' '}${esc(base)}${has ? ' <b>미흡</b>' : ''}${c.companies ? ` <span class="cnt" title="이 항목에 지적이 있는 회사 수(심의안 (N개사))">전체 ${c.companies}개사</span>` : ''}${has && !(mine.f.length || mine.etc) && !(it.key === 'i17' && c.rows.some(r => r.cos[ci])) ? ' <span class="need" title="미흡으로 표시했지만 지적 문안을 고르거나 기타(자유기재)를 쓰지 않았습니다">지적 문안 미선택</span>' : ''}</span>
        <span class="co-cls"><label><input type="radio" name="cocls_${it.key}_${ci}" data-f="cocls" value="0" ${has ? '' : 'checked'}>미지적</label><label><input type="radio" name="cocls_${it.key}_${ci}" data-f="cocls" value="1" ${has ? 'checked' : ''}>미흡</label></span></div>`;
      if (!has) return `<div class="dr-item co-none" data-ikey="${it.key}">${head}</div>`;
      const P = Q().indiPool(it); const v = c.variant;
      const opts = `<option value="auto" ${c.auto ? 'selected' : ''}>자동 — ${esc(v.label || (v.rules || []).join(' · '))}</option>${it.variants.map((x, i) => `<option value="${i}" ${!c.auto && i === c.vi ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}`;
      const subs = Q().SUBS[it.key] ? `<div class="co-subs">${Q().SUBS[it.key].map(([sk, label]) => `<label class="chip ${(Number(((st.subs || {})[sk] || [])[ci]) || 0) > 0 ? 'on' : ''}"><input type="checkbox" data-sub="${it.key}:${sk}" data-i="${ci}" ${(Number(((st.subs || {})[sk] || [])[ci]) || 0) > 0 ? 'checked' : ''}>${esc(label)}</label>`).join('')}</div>` : '';
      return `<div class="dr-item on" data-ikey="${it.key}">${head}${subs}
        <div class="dr-ref"><b>관련 규정</b> ${esc((v.rules || []).join(' · ') || '-')}${c.auto ? ' <span class="autotag" title="모든 회사에서 고른 지적을 함께 덮는 기준서 문단 판(가장 좁은 것)을 골랐습니다. 소규모기업이 있으면 「감사기준서 1200」 판">자동</span>' : ''}
          <select data-f="vsel" title="기준서 문단 판 — 자동(권장) 또는 직접">${opts}</select><details><summary>기준 문단 보기</summary><p>◦ ${esc(v.basis || '')}</p></details></div>
        ${grpHtml(it, mine)}
        <div class="dr-finds">${P.map((e, i) => (shown(it, mine, e.text) ? `<div class="dr-find ${mine.f.includes(e.text) ? 'on' : ''}"><label class="dr-chk"><input type="checkbox" data-f="cf" data-n="${i}" ${mine.f.includes(e.text) ? 'checked' : ''}>- ${esc(e.text)}</label></div>` : '')).join('')}
          <div class="dr-find etc ${mine.etc ? 'on' : ''}"><label class="dr-chk">기타(자유기재)</label><textarea data-f="cetc" rows="2" placeholder="- … 에 대한 문서화가 미흡함 (쓰면 과거 사례 중 가장 비슷한 지적으로 기준서 문단을 고릅니다)">${esc(mine.etc)}</textarea></div>
        </div></div>`;
    }).join('');
    return `<div class="qc-sec co-part"><span>${esc(part)}</span></div><div class="dr-grp">${rows}</div>`;
  }).join('');
  const miss = missingPicks().indi.filter(x => x.ci === ci);
  const warn = miss.length ? `<div class="qc-check dr-warn"><b>체크할 곳</b> — 미흡으로 바꿨지만 지적 문안을 고르지 않은 항목: ${miss.map(x => esc(x.title)).join(', ')}</div>` : '';
  return `<div class="co-tabs">${tabs}</div>${warn}
    <div class="co-head"><b>${esc(name)}</b><label title="소규모기업이면 이 회사의 지적이 있는 항목은 「감사기준서 1200」(소규모기업) 문단을 함께 인용합니다"><input type="checkbox" data-f="small" data-i="${ci}" ${small ? 'checked' : ''}> 소규모기업</label>
      <span class="dr-hint">평가표 체크와 서로 연동 — 여기서 [미흡]으로 바꾸면 평가표에도 체크됩니다. 미지적 항목은 회색.</span></div>
    ${parts}
    <p class="dr-hint">심의안에는 항목마다 지적이 있는 회사 수(N개사)와 회사들의 지적을 함께 쓰고, 기준서 문단은 그 지적들을 모두 덮는 판으로 씁니다.</p>`;
}
function iviolHtml() {
  const vp = ctx.phrases.viol || {}; const vs = sel.indi.viol || {};
  const opts = [{ key: 'gaap', label: '회계처리기준(GAAP) 위반 혐의' }, { key: 'gaas', label: '회계감사기준(GAAS) 위반 혐의' }];
  const chosen = opts.filter(o => (vs[o.key] || {}).on).map(o => o.key);
  const eds = opts.filter(o => chosen.includes(o.key)).map(o => { const st = vs[o.key] || {}; const ex = (vp[o.key] || {}).example || '';
    return `<div class="dr-item law on" data-vkey="${o.key}"><div class="dr-row"><span class="dr-title">${esc(o.label)}</span>${violCtl(st, o.key === 'gaap' ? 'GAAP' : 'GAAS')}</div><textarea data-f="text" rows="3" placeholder="${esc(ex)}">${esc(st.text || '')}</textarea></div>`; }).join('');
  return `<div class="qc-sec"><span>위반 혐의(개별감사업무 점검과정)</span></div>
    ${multiSelect('iviol', '위반 혐의', opts, chosen)}
    <div class="dr-grp">${eds || '<p class="dr-hint">고른 것이 없으면 초안의 해당 문단과 처리안의 ※ 줄이 빠집니다.</p>'}</div>
    <p class="dr-hint">예시 문구는 입력칸에 연한 글씨로 보이고, 쓴 글이 우선합니다.</p>`;
}
function priorHtml(m) {
  const pr = sel.indi.prior || {};
  return `<div class="qc-sec"><span>직전 감리와 비교표</span></div>
    <div class="dr-prior"><label>이번 감리 연도 <input type="number" data-f="year" value="${esc(sel.indi.year || '')}" placeholder="${new Date().getFullYear()}"></label><label>직전 점검회사 수 <input type="number" data-f="pcompanies" min="0" value="${esc(pr.companies ?? '')}"></label><label>직전 지적수 <input type="number" data-f="pfindings" min="0" value="${esc(pr.findings ?? '')}"></label></div>
    <table class="qc dr-check" style="width:auto;min-width:520px"><thead><tr><th>구분</th><th>점검회사수</th><th>점검항목</th><th>총항목수</th><th>지적수</th><th>지적률</th></tr></thead><tbody>
      <tr><td>${esc(m.indi.prior.year ? m.indi.prior.year + '년' : '직전')}</td><td>${m.indi.prior.companies || '-'}</td><td>${m.indi.itemsTotal}개</td><td>${m.indi.prior.totalItems || '-'}</td><td>${m.indi.prior.findings || '-'}</td><td>${m.indi.prior.companies ? m.indi.prior.rate + '%' : '-'}</td></tr>
      <tr><td>${esc(String(m.indi.year))}년</td><td>${m.indi.K}개사</td><td>${m.indi.itemsTotal}개</td><td>${m.indi.totalItems}</td><td>${m.indi.total}</td><td>${m.indi.rate}%</td></tr></tbody></table>
    <p class="dr-hint">직전 감리년도는 「기본 정보」의 직전 감리년도를 씁니다. 이번 감리의 총항목수(회사 수 × 17)·지적수·지적률은 체크 상태에서 셈합니다.</p>`;
}
function previewHtml(m) {
  const orgRows = m.org.groups.length ? m.org.groups.map(g => g.items.map((it, i) => `<tr>${i === 0 ? `<td class="lab" rowspan="${g.items.length}">${esc(g.title)}</td>` : ''}<td class="l">${esc(it.label)}</td>${i === 0 ? `<td rowspan="${g.items.length}">${esc(g.typeLabel)}</td><td rowspan="${g.items.length}">공개</td>` : ''}</tr>`).join('')).join('')
    : '<tr><td colspan="4" class="empty-row">체크한 지적사항이 없습니다</td></tr>';
  const indiRows = m.indi.parts.length ? m.indi.parts.map(p => `<tr><td class="lab">${esc(p.part)}</td><td class="l">${p.rows.map(r => `◦ ${esc(r.title)}`).join('<br>')}</td><td class="num">${p.rows.map(r => r.companies).join('<br>')}</td></tr>`).join('') + `<tr><td class="lab sum">합계</td><td class="sum"></td><td class="num sum"><b>${m.indi.total}</b></td></tr>`
    : '<tr><td colspan="3" class="empty-row">체크한 지적사항이 없습니다</td></tr>';
  const types = Object.entries(m.org.byType).filter(([, n]) => n > 0).map(([k, n]) => `${n}건은 ${k === '일부미흡' ? '품질관리절차 설계․운영상 일부 미흡' : k}`).join(', ');
  return `<div class="dr-pv">
    <div class="qc-sec"><span>품질관리절차 관련 지적사항</span><span class="unit">중점점검항목 ${m.org.count}건${types ? ` · ${types}` : ''}</span></div>
    <table class="qc"><thead><tr><th>중점점검항목</th><th>지적사항</th><th>유형</th><th>공개여부</th></tr></thead><tbody>${orgRows}</tbody></table>
    <div class="qc-sec"><span>개별감사업무 관련 지적사항</span><span class="unit">${m.indi.K}개사 × ${m.indi.itemsTotal}개 항목 = ${m.indi.totalItems} · 지적 ${m.indi.total}건 · 지적률 ${m.indi.rate}%${m.indi.prior.companies ? ` (직전 ${m.indi.prior.year || ''}년 ${m.indi.prior.rate}%)` : ''}</span></div>
    <table class="qc"><thead><tr><th>부 문</th><th>제 목</th><th>건수</th></tr></thead><tbody>${indiRows}</tbody></table>
    <p class="qc-note">처리안: 품질관리제도 관련 ${m.org.count}건과 개별감사업무 관련 ${m.indi.total}건${m.viol.any ? ` · 위반 혐의: ${[m.viol.gaap ? 'GAAP' : '', m.viol.gaas ? 'GAAS' : '', ...m.viol.law.map(x => x.title)].filter(Boolean).join(', ')}` : ''} · 품질관리수준 ${m.score.total.toFixed(1)}점 <b>${m.score.level}</b></p>
  </div>`;
}

/* ── 입력(왼쪽·오른쪽 같은 처리기) ── */
function setK(n) { sel.indi.K = Math.max(1, Math.min(20, Number(n) || 0)); syncCompanies(); save(); render(); }
function wire(root) {
  if (root.dataset.wired) return; root.dataset.wired = '1';
  root.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.id === 'drBack') { if (guardLeave()) closeDraft(); return; }
    if ((t.dataset.tab && t.dataset.tab !== tab) || (t.dataset.view && t.dataset.view !== view)) { if (!guardLeave()) return; }
    if (t.dataset.tab) { tab = t.dataset.tab; if (view.startsWith(tab === 'org' ? 'indi:' : 'org:') || (tab === 'org' && view.startsWith('co:')) || ['law', 'deduct', 'iviol', 'prior'].includes(view)) view = 'check'; render(); return; }
    if (t.dataset.view) { view = t.dataset.view; render(); const main = $('draftMain'); if (main && main.scrollIntoView && root.id === 'draftPanel') main.scrollIntoView({ block: 'start' }); return; }
    if (t.id === 'drVoReset') { sel.org.violOvr = {}; save(); render(); return; }
    if (t.dataset.fold) { folds[t.dataset.fold] = !folds[t.dataset.fold]; render(); return; }
    if (t.id === 'drHwpx' || t.id === 'drPdf') {
      const lines = missingText();
      const go = () => (t.id === 'drHwpx' ? ctx.downloadDraft(currentModel(), sel) : ctx.previewDraft && ctx.previewDraft(currentModel(), sel));
      if (!lines.length) { go(); return; }
      ctx.showConfirm(`아래는 아직 체크되지 않았습니다(지적 문안 없이 항목 제목만 들어갑니다).\n\n${lines.join('\n')}\n\n그래도 만들까요?`, { title: '체크할 곳', okText: '그래도 만들기' }).then(ok => { if (ok) go(); });
      return;
    }
    if (t.id === 'drGang') { ctx.downloadGangpyeong(currentModel(), sel); return; }
    if (t.id === 'drXlsx') { ctx.downloadEval(currentModel(), sel); return; }
    if (t.id === 'drSave') { saveFile(); return; }
    if (t.id === 'drLoad') { loadFile(); return; }
    if (t.id === 'drReset') { ctx.showConfirm('이 회계법인의 체크 상태를 모두 지울까요? (저장한 파일은 그대로)', { title: '초기화', okText: '지우기', danger: true }).then(ok => { if (!ok) return; sel = defaults(); syncCompanies(); save(); render(); }); }
  });
  const onChange = (e) => {
    const el = e.target; const f = el.dataset.f;
    if (f === 'K') { setK(el.value); return; }
    if (f === 'Kn') { if (e.type === 'change') setK(el.value); return; }
    if (el.dataset.co != null) { sel.indi.companies[Number(el.dataset.co)] = el.value; save(); if (e.type === 'change') render(); return; }
    if (el.dataset.ck) {   // 평가표 체크 — 조직 분류
      const st = sel.org.items[el.dataset.ck] || (sel.org.items[el.dataset.ck] = {});
      st.cls = el.value; if (st.cls !== '미지적' && st.text == null) st.text = '';
      save(); render(); notifyWarnings(); return;
    }
    if (el.dataset.mk) {   // 평가표 체크 — 개별 회사별 지적
      const st = sel.indi.items[el.dataset.mk] || (sel.indi.items[el.dataset.mk] = { variant: 0, picks: [] });
      const marks = st.marks || (st.marks = new Array(K()).fill(0)); while (marks.length < K()) marks.push(0);
      marks[Number(el.dataset.i)] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : Math.max(0, Number(el.value) || 0);
      if (el.type === 'checkbox' && !el.checked) {   /* 평가표에서 끄면 회사 탭의 그 회사 지적도 지운다(서로 연동, 사용자 지정 2026-10-08) */
        const ci = Number(el.dataset.i); if (st.co && st.co[ci]) st.co[ci] = { f: [], etc: '' };
        for (const pk of st.picks || []) if (pk.cos) pk.cos[ci] = false;
      }
      save(); if (e.type === 'change') render(); return;
    }
    if (el.dataset.sub) {   // 평가표 체크 — ⑩·⑮ 하위 항목
      const [ikey, sk] = el.dataset.sub.split(':');
      const st = sel.indi.items[ikey] || (sel.indi.items[ikey] = { variant: 0, picks: [] }); st.subs = st.subs || {};
      const arr = st.subs[sk] || (st.subs[sk] = new Array(K()).fill(0)); while (arr.length < K()) arr.push(0);
      arr[Number(el.dataset.i)] = el.checked ? 1 : 0; save(); render(); return;
    }
    if (el.dataset.ms) {   // 여러 개 고르는 드롭다운
      const id = el.dataset.ms; const key = el.value;
      if (id === 'law') { const st = sel.org.law[key] || (sel.org.law[key] = {}); st.on = el.checked; }
      if (id === 'iviol') { sel.indi.viol = sel.indi.viol || {}; const st = sel.indi.viol[key] || (sel.indi.viol[key] = {}); st.on = el.checked; }
      save(); render(); const d = document.querySelector(`details[data-msel="${id}"]`); if (d) d.open = true; return;
    }
    const org = el.closest('[data-key]'), law = el.closest('[data-law]'), viol = el.closest('[data-viol]'), ind = el.closest('[data-ikey]'), vk = el.closest('[data-vkey]');
    if (org) {
      const st = sel.org.items[org.dataset.key] || (sel.org.items[org.dataset.key] = {});
      if (f === 'cls') { st.cls = el.value; if (st.cls !== '미지적' && st.text == null) st.text = ''; save(); render(); notifyWarnings(); return; }
      if (f === 'ex') { const it = findOrg(org.dataset.key); const exCls = st.cls === '미설계' ? '미운영' : st.cls; st.ex = el.value === 'etc' ? 'etc' : Number(el.value); st.text = el.value === 'etc' ? '' : (it.examples[exCls] || [])[Number(el.value)] || '';
        delete st.ther; delete st.therText;   /* 문안을 바꾸면 따라서도 그 문안에 맞게 다시 자동 선택 */
        save(); render(); return; }
      if (f === 'repeat') { st.repeat = el.checked; save(); render(); return; }
      if (f === 'text') { st.text = el.value; save(); return; }
      if (f === 'ther') { st.ther = Number(el.dataset.i); delete st.therText; save(); render(); return; }
      if (f === 'therText') { const it = findOrg(org.dataset.key); const list = it.therefore || []; const cur = Number.isInteger(st.ther) ? st.ther : Q().autoTher(it, st).i;
        if (el.value.trim() === (list[cur] || '').trim()) delete st.therText; else st.therText = el.value; save(); return; }
    }
    if (law) { const st = sel.org.law[law.dataset.law] || (sel.org.law[law.dataset.law] = {});
      if (f === 'noqc') { st.noqc = el.checked; save(); render(); return; }
      if (f === 'n') { st.n = Math.max(1, Number(el.value) || 1); save(); if (e.type === 'change') render(); return; }
      st[f] = el.value; save(); return; }
    if (viol) { const st = sel.org.viol[viol.dataset.viol] || (sel.org.viol[viol.dataset.viol] = {}); st[f] = Number(el.value); save(); if (e.type === 'change') render(); return; }
    const vo = el.closest('[data-vo]');
    if (vo && (f === 'von' || f === 'vop')) {   // 차감 표 손으로 고침
      sel.org.violOvr = sel.org.violOvr || {}; const o = sel.org.violOvr[vo.dataset.vo] || (sel.org.violOvr[vo.dataset.vo] = {});
      o[f === 'von' ? 'n' : 'pts'] = el.value === '' ? undefined : Number(el.value);
      if (o.n === undefined && o.pts === undefined) delete sel.org.violOvr[vo.dataset.vo];
      save(); if (e.type === 'change') render(); return;
    }
    if (f === 'reason') { sel.org.reason = el.value; save(); return; }
    if (vk) { const st = sel.indi.viol[vk.dataset.vkey] || (sel.indi.viol[vk.dataset.vkey] = {});
      if (f === 'noqc') { st.noqc = el.checked; save(); render(); return; }
      if (f === 'n') { st.n = Math.max(1, Number(el.value) || 1); save(); if (e.type === 'change') render(); return; }
      st.text = el.value; save(); return; }
    if (f === 'year') { sel.indi.year = el.value; save(); if (e.type === 'change') render(); return; }
    if (f === 'pcompanies' || f === 'pfindings') { sel.indi.prior = sel.indi.prior || {}; sel.indi.prior[f === 'pcompanies' ? 'companies' : 'findings'] = el.value; save(); if (e.type === 'change') render(); return; }
    if (f === 'small') { sel.indi.small = sel.indi.small || []; sel.indi.small[Number(el.dataset.i)] = el.checked; save(); render(); return; }
    const coView = view.startsWith('co:') ? Math.min(Number(view.slice(3)) || 0, K() - 1) : (view.startsWith('indi:') ? 0 : -1);
    if (ind && coView >= 0 && ['cocls', 'cf', 'cetc', 'vsel', 'cg'].includes(f)) {
      const key = ind.dataset.ikey; const it = ctx.phrases.indi.items.find(x => x.key === key); const ci = coView;
      const st = sel.indi.items[key] || (sel.indi.items[key] = {});
      st.co = st.co || {}; const mine = st.co[ci] || (st.co[ci] = { f: [], etc: '' });
      if (st.picks && st.picks.length) { const cs = Q().indiCounts(it, { indi: { items: { [key]: { ...st, co: {}, marks: [], subs: null } } } }, K()).co; cs.forEach((c, i) => { const t = st.co[i] || (st.co[i] = { f: [], etc: '' }); for (const x of c.f) if (!t.f.includes(x)) t.f.push(x); if (c.etc && !t.etc) t.etc = c.etc; }); st.picks = []; }
      const marks = st.marks || (st.marks = new Array(K()).fill(0)); while (marks.length < K()) marks.push(0);
      if (f === 'cocls') {
        if (el.value === '1') marks[ci] = 1;
        else { marks[ci] = 0; st.co[ci] = { f: [], etc: '' }; if (st.subs) for (const sk of Object.keys(st.subs)) if (st.subs[sk]) st.subs[sk][ci] = 0; }
        save(); render(); return;
      }
      if (f === 'cf') { const t = Q().indiPool(it)[Number(el.dataset.n)].text; mine.f = mine.f.filter(x => x !== t); if (el.checked) mine.f.push(t); marks[ci] = 1;
        if (el.checked && Q().SUBS[key]) {   /* 지적 → 평가표 하위 줄도 체크(⑩ sub_of 사전 · ⑰ 감사계획 s1/독립성 s2) */
          st.subs = st.subs || {}; const on = (sk) => { const a = st.subs[sk] || (st.subs[sk] = new Array(K()).fill(0)); while (a.length < K()) a.push(0); a[ci] = 1; };
          if (it.sub_of && it.sub_of[t]) on(it.sub_of[t]);
          if (key === 'i17') { if (/감사계획|중요성|전반감사|범위 설정|위험평가/.test(t)) on('s1'); if (/독립성/.test(t)) on('s2'); }
        }
        save(); render(); return; }
      if (f === 'cg') {   /* 상위 계정 묶음 — 끄면 그 묶음에서 고른 지적도 지운다 */
        const g = (it.groups || []).find(x => x.name === el.dataset.g); mine.g = (mine.g || []).filter(x => x !== el.dataset.g);
        if (el.checked) mine.g.push(el.dataset.g); else if (g) mine.f = mine.f.filter(t => !g.texts.includes(t));
        save(); render(); return;
      }
      if (f === 'cetc') { mine.etc = el.value; if (el.value.trim()) marks[ci] = 1; save(); if (e.type === 'change') render(); return; }
      if (f === 'vsel') { if (el.value === 'auto') delete st.vsel; else st.vsel = Number(el.value); save(); render(); return; }
    }
    if (ind) {
      const st = sel.indi.items[ind.dataset.ikey] || (sel.indi.items[ind.dataset.ikey] = { variant: 0, picks: [] });
      st.picks = st.picks || [];
      if (f === 'variant') { st.variant = Number(el.value); st.picks = []; save(); render(); return; }
      const fd = el.closest('[data-idx]'); if (!fd) return;
      const idx = fd.dataset.idx === 'etc' ? 'etc' : Number(fd.dataset.idx);
      const pk = st.picks.find(x => String(x.idx) === String(idx));
      if (f === 'pick') { if (el.checked && !pk) st.picks.push({ idx, text: '', cos: new Array(K()).fill(false) }); if (!el.checked) st.picks = st.picks.filter(x => String(x.idx) !== String(idx)); save(); render(); return; }
      if (!pk) return;
      if (f === 'co') { pk.cos[Number(el.dataset.i)] = el.checked; save(); render(); return; }
      if (f === 'etext') { pk.text = el.value; save(); return; }
    }
  };
  root.addEventListener('change', onChange);
  root.addEventListener('input', (e) => { if (e.target.matches('textarea, input[type="text"], input[type="number"]')) onChange(e); });
}
function findOrg(key) { for (const g of ctx.phrases.org.groups) for (const it of g.items) if (it.key === key) return it; return null; }

/* ── 파일 저장/불러오기(조직·개별 담당자가 따로 쓰고 합친다) ── */
function saveFile() {
  const p = ctx.state.profile; const part = tab;
  const data = { kind: 'qc-draft', corp_code: p.corp_code, firm: p.corp_name, part, saved: new Date().toISOString(), sel: { [part]: sel[part] } };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = `심의안_${part === 'org' ? '조직' : '개별'}_${String(p.corp_name).replace(/[\\/:*?"<>|]/g, '_')}_${new Date().toISOString().slice(2, 10).replace(/-/g, '')}.json`; document.body.append(a); a.click(); a.remove();
  ctx.toast(`${part === 'org' ? '조직' : '개별'} 작업을 파일로 저장했습니다.`);
}
function loadFile() {
  const i = document.createElement('input'); i.type = 'file'; i.accept = '.json';
  i.onchange = async () => {
    const f = i.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d || d.kind !== 'qc-draft' || !d.sel) throw new Error('심의안 체크 상태 파일이 아닙니다.');
      if (d.corp_code && d.corp_code !== ctx.state.profile.corp_code && !(await ctx.showConfirm(`다른 회계법인(${d.firm || d.corp_code})의 파일입니다. 그래도 불러올까요?`, { title: '불러오기', okText: '불러오기' }))) return;
      const parts = Object.keys(d.sel).filter(k => k === 'org' || k === 'indi');
      for (const k of parts) sel[k] = { ...defaults()[k], ...d.sel[k] };
      syncCompanies(); save(); render();
      ctx.toast(`${parts.map(k => k === 'org' ? '조직' : '개별').join('·')} 작업을 파일에서 불러와 합쳤습니다.`);
    } catch (e) { ctx.showAlert(ctx.describe(e), { title: '불러오기' }); }
  };
  i.click();
}
