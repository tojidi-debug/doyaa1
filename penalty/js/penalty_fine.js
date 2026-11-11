/* [심사·감리업무] > [과징금 산정].
 *
 * 「외부감사 및 회계 등에 관한 규정」 [별표1] 조치양정기준 · [별표8] 과징금 부과기준(구 기준)에 따라
 * 대상자별 과징금을 센다. 화면은 세 단계다.
 *
 *   1 사건 입력   기본정보 · 회사관계자 · 위반사항과 위법행위 중요도(한 표)
 *   2 가중·감경   사유를 체크한다. 그룹마다 한도가 걸리고 걸린 것은 붉게 보인다
 *   3 결과        산출 과정 · 한글(hwpx) 내려받기
 *
 * ## 법령 숫자도 셈도 이 파일에 없다
 *
 * 기준값은 `penalty_fine_rules.js`, 셈은 `penalty_fine_calc.js`(DOM 없음 — node 로 시험한다)에 있다.
 * 이 파일은 입력을 모아 셈을 부르고 결과를 그린다. 한글 파일은 `penalty_fine_hwpx.js` 가 만든다.
 *
 * ## ⚠️ 서버를 부르지 않는다
 *
 * 전부 이 화면에서 센다. 입력한 값은 이 브라우저의 `localStorage` 에만 남고 우리 서버로 가지 않는다.
 *
 * ## ⚠️ 이름표를 갈 때는 `class="…"` 만이 아니라 **찾는 자리도** 함께 간다
 *
 * `querySelectorAll('.pf-sec')` 처럼 JS 가 찾는 이름이 마크업·CSS 에 실제로 있는지는
 * `scripts/penalty_fine_check.py` 가 전수로 본다.
 */
import './ui/guard.js';   // 오른쪽 버튼·F12 차단 (담당부서 요청). 한계는 그 파일에.
import { OLD_RULES } from './penalty_fine_rules.js';
import { NEW_RULES } from './penalty_new_rules.js';
import { compareBases, computeAll, hasSevereMark, maxAcrossYears, personBase, personPresent, severeIn } from './penalty_fine_calc.js';
import { buildHwpx, download } from './penalty_fine_hwpx.js';
import { buildReport } from './penalty_fine_report.js';
import { EXAMPLE_ID, EXAMPLE_NAME, EXAMPLE_ON, looksLikeOldExample, sampleState } from './penalty_fine_sample.js';

/* ── 어느 기준으로 여는가 ───────────────────────────────────────────
 * 같은 화면 코드를 두 주소가 쓴다 — `penalty_fine.html`(구) 와 `penalty_new.html`(신). `<body data-pf-rules="old|new">` 가 고른다.
 * 입력은 두 주소가 **같은 저장소 칸**을 써서 그대로 넘어가고, 결과는 항상 두 기준으로 모두 세어 견준다(유리한 쪽으로 결정). */
const MODE = document.body.dataset.pfRules === 'new' ? 'new' : 'old';
const R = MODE === 'new' ? NEW_RULES : OLD_RULES;
const OTHER = MODE === 'new' ? OLD_RULES : NEW_RULES;
const {
  COMPANY_TYPES, MITIGATE_GROUPS, MITIGATE_REASONS, PARTIES, PERSON_ROLES, REASON_FREE, REASON_SAMPLES,
  REPORTER_MAX_PCT, REVISION, REVISION_DETAIL, WEIGHT_GROUPS, WEIGHT_REASONS, WEIGHT_TOTAL_CAP_PCT,
} = R;

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const num = (n) => Math.round(n || 0).toLocaleString('ko-KR');
/** 머리띠에 보이는 금액은 백만원 단위(사용자 지정 2026-11-09) — 소수 첫째 자리까지. 표의 금액은 원 단위 그대로다. */
const mil = (n) => (n ? (Math.round(n / 100000) / 10).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '0');
const moneyStr = (n) => (n ? Number(n).toLocaleString('ko-KR') : '');
const parseMoney = (s) => +String(s).replace(/[^0-9]/g, '') || 0;
const pctText = (x) => `${Math.round(x * 1000) / 10}%`;
/** 점수 위에 (적용률) 아래 — 두 줄. */
const scoreCell = (tenths, rate) => `<span class="pf-sc">${scoreText(tenths)}</span><span class="pf-rt">(${pctText(rate)})</span>`;
const scoreText = (tenths) => (tenths / 10).toFixed(2).replace(/0$/, '');

function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'pf-toast' + (kind === 'err' ? ' pf-toast-bad' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
// 입력 중에는 그대로 두고, 포커스를 벗어날 때 콤마 형식으로 다시 그려준다(타이핑 중에 다시 그리면 커서가 튄다).
const wireMoneyBlur = (el) => el.addEventListener('blur', () => { el.value = moneyStr(parseMoney(el.value)); });

/* ── 상태 ────────────────────────────────────────────────────────────
 * 위법행위가 여러 사업연도에 걸치면(별표8 4.가) 연도마다 중요성금액·임원 구성·보수·위반사항·
 * 가중감경 사유가 다를 수 있고, 대상자별로 **연도별 산정액 중 가장 큰 금액**을 부과한다. 그래서
 * 연도마다 독립된 케이스를 두고, 화면에는 그중 하나(activeYear)만 편집 중으로 띄운다.
 * 회사 구분·차감액·신고자 감경은 사건 하나에 하나다. */
const MAX_FISCAL_YEARS = 8;
let companyType = 'general';
let fiscalYears = [{ term: '', year: '' }];
let cases = [];
let activeYear = 0;
let reporter = {};
let vidSeq = 1;
let resultView = 'max';
let currentSec = 'input';
/* MAX 탭(사용자 지정 2026-11-09): 여러 해일 때 과징금이 가장 큰 해 하나만 본다. 회사 과징금이 있으면 회사 기준, 회사 조치가 없고 감사인만 있으면
   감사인 기준, 그것도 없으면 임원 기준으로 가장 큰 해. `lastMaxIdx` 는 매번 센 결과에서 갱신된다. */
let maxMode = false;
let lastMaxIdx = 0;
function pickMaxYear(perYear) {
  const sums = (pick) => perYear.map((p) => Object.values(p.result.parties).filter(pick).reduce((a, d) => a + (d.final || 0), 0));
  for (const pick of [(d) => d.kind === 'company', (d) => d.kind === 'auditor', (d) => d.kind === 'person']) {
    const v = sums(pick);
    const m = Math.max(...v);
    if (m > 0) return v.indexOf(m);
  }
  return 0;
}

const newYearCase = () => ({
  materiality: 0,
  priorFine: 0,
  persons: PERSON_ROLES.map((role) => ({ role, name: '', comp: 0 })),
  violations: [],
  weight: {},
  mitigate: {},
});
const cur = () => cases[activeYear];
const availableRoles = (c = cur()) => c.persons.filter((p) => personPresent(p, R)).map((p) => p.role);

function newViolation() {
  return { id: vidSeq++, desc: '', amount: 0, type: 'A', motive: '중과실', severe: false, group: '', market: 1, who: {} };   // severe: false | true(상) | 'new'(상(신) — 신 기준에서만 상)
}
// 감사·감사인은 회사가 고의여도 중과실로 보는 일이 많아 중과실을 기본으로 둔다(실사례). 대표·재무·담당은 회사 동기를 따른다.
// 관여자 기본 동기: 회사 동기를 따른다(회사가 「고의·상」이면 대표·재무·담당도 「고의·상」). 감사·감사인은 중과실(실사례).
const defaultWho = (role, motive, severe = false) => (motive === '과실' ? '' : role === '감사인' || role === '감사' ? '중과실' : motive === '고의' && severe ? '고의상' : motive);
/** 회사 동기·상을 바꾸면, 그 기본값을 따르던 관여자도 같이 바꾼다. 따로 고른 사람은 그대로 둔다. */
function followWho(c, v, oldMotive, oldSevere) {
  for (const role of availableRoles(c)) {
    const cur = v.who[role] === '고의상신' ? '고의상' : v.who[role];
    if (!cur || cur === defaultWho(role, oldMotive, oldSevere)) v.who[role] = defaultWho(role, v.motive, v.severe);
  }
}
function fillWho(c) {
  const roles = availableRoles(c);
  for (const v of c.violations) {
    for (const role of PERSON_ROLES) {
      // 관여자 칸이 막힌(보수·성명이 없는) 사람의 값은 지우지 않는다 — (구)·(신) 두 화면이 같은 저장소를 쓰는데
      // 한쪽에서는 막혀 있어도 다른 쪽에서는 열려 있을 수 있다(신: 성명만으로 대상). 셈은 대상자가 있을 때만 값을 본다.
      if (roles.includes(role) && v.who[role] === undefined) v.who[role] = defaultWho(role, v.motive, v.severe);
    }
  }
}
const fyLabel = (fy, idx) => {
  const t = (fy.term || '').trim(); const y = (fy.year || '').trim();
  if (t && y) return `제${t}기(${y})`;
  if (t) return `제${t}기`;
  return y || `연도 ${idx + 1}`;
};
/**
 * 묶음 — 화면에서 적지 않고 위반사항 이름으로 **자동**으로 정한다(사용자 지정 2026-11-09).
 *   · 「가-1. …」「가-2. …」처럼 이름이 `라벨-번호` 로 시작하면 같은 라벨(가)끼리 한 묶음
 *   · 같은 연도에 이름이 똑같은 줄(같은 위반사항을 유형 A·B·D 로 나눠 적은 것)도 한 묶음
 * 묶인 줄은 관계자·감사인 점수에서 위법행위 내용이 같으면 합쳐 위반규모를 센다(회사는 줄마다).
 */
const GROUP_LABEL = /^\s*([가-힣A-Za-z0-9]{1,3})\s*[-–—]\s*\d+/;
function autoGroup(vs) {
  const count = new Map();
  for (const v of vs) { const d = String(v.desc || '').trim(); if (d) count.set(d, (count.get(d) || 0) + 1); }
  for (const v of vs) {
    const d = String(v.desc || '').trim();
    const m = GROUP_LABEL.exec(d);
    v.group = m ? m[1] : (d && count.get(d) > 1 ? d : '');
  }
}
const inputOf = (c) => (autoGroup(c.violations), {
  companyType, materiality: c.materiality, priorFine: c.priorFine || 0,
  violations: c.violations, persons: c.persons, weight: c.weight, mitigate: c.mitigate, reporter,
});

/* ── 연도 ─────────────────────────────────────────────────────────── */
function switchYear(idx) {
  maxMode = false;
  if (idx === activeYear) { renderYearTabs(); return; }
  activeYear = idx;
  renderAll();
}
function showMaxYear() {
  maxMode = true;
  activeYear = Math.min(lastMaxIdx, cases.length - 1);
  renderAll();
}
function renderYearTabs() {
  const box = $('yearTabs');
  // 단계 제목에 지금 보는 연도를 적는다 — 연도 탭을 누르면 그 연도의 입력·가중감경이 나온다.
  const multi = cases.length > 1;
  const yr = multi ? ` · ${fyLabel(fiscalYears[activeYear], activeYear)}${maxMode ? ' (MAX)' : ''}` : '';
  const t1 = document.querySelector('#sec-input .pf-sec-title > span');
  const t2 = document.querySelector('#sec-adjust .pf-sec-title > span');
  if (t1) t1.textContent = '1. 사건 입력' + yr;
  if (t2) t2.textContent = '2. 가중 · 감경' + yr;
  if (!multi) { box.innerHTML = ''; box.hidden = true; return; }
  box.hidden = false;
  if (currentSec === 'result') {
    // 결과 단계에서도 같은 자리의 탭이 연도를 고른다: 맨 앞은 대상자별 최대(최종), 나머지는 연도별 산출.
    box.innerHTML = `<button type="button" class="pf-ytab ${resultView === 'max' ? 'active' : ''}" data-rv="max">최종 (연도별 중 최대)</button>`
      + cases.map((c, i) => `<button type="button" class="pf-ytab ${resultView === i ? 'active' : ''}" data-rv="${i}">${esc(fyLabel(fiscalYears[i], i))}</button>`).join('');
    box.querySelectorAll('[data-rv]').forEach((b) => b.addEventListener('click', () => {
      resultView = b.dataset.rv === 'max' ? 'max' : +b.dataset.rv;
      renderYearTabs(); recalc();
    }));
    return;
  }
  box.innerHTML = `<button type="button" class="pf-ytab pf-ytab-max ${maxMode ? 'active' : ''}" data-max title="과징금이 가장 큰 해만 봅니다(회사 기준, 회사 조치가 없으면 감사인 기준)">MAX <span class="pf-u">${esc(fyLabel(fiscalYears[lastMaxIdx], lastMaxIdx))}</span></button>`
    + cases.map((c, i) => `
    <button type="button" class="pf-ytab ${i === activeYear && !maxMode ? 'active' : ''}" data-year="${i}">${esc(fyLabel(fiscalYears[i], i))}</button>`).join('');
  box.querySelectorAll('[data-year]').forEach((b) => b.addEventListener('click', () => switchYear(+b.dataset.year)));
  box.querySelector('[data-max]').addEventListener('click', showMaxYear);
}
// 새 연도는 직전 연도를 이어받는다 — 기수·회계연도는 1씩 올리고, 중요성금액·관계자·위반사항 틀·가중감경 사유를 복사한다.
// 위반금액은 해마다 달라 비워 둔다(금액을 적어야 산정 대상이 된다). 사유가 다른 해는 2단계에서 고치면 된다.
function addFiscalYear() {
  if (fiscalYears.length >= MAX_FISCAL_YEARS) { toast(`위반 회계연도는 최대 ${MAX_FISCAL_YEARS}개까지 추가할 수 있습니다.`, 'err'); return; }
  const prevFy = fiscalYears[fiscalYears.length - 1];
  const prev = cases[cases.length - 1];
  fiscalYears.push({
    term: /^\d+$/.test(prevFy.term) ? String(+prevFy.term + 1) : '',
    year: /^\d{4}$/.test(prevFy.year) ? String(+prevFy.year + 1) : '',
  });
  const next = JSON.parse(JSON.stringify(prev));
  for (const v of next.violations) { v.id = vidSeq++; v.amount = 0; }
  cases.push(next);
  activeYear = cases.length - 1;
  renderAll();
}
function renderFiscalYears() {
  const box = $('fiscalYearsBox');
  // 연도가 셋 넘게 많으면 기본정보 한 줄에 못 담는다 — 연도 칸을 아래 줄로 내려 줄바꿈하며 모두 보인다(가로 막대로 숨기지 않는다).
  const row = box.closest('.pf-basic');
  if (row) row.classList.remove('pf-many');
  // 기본정보에는 **지금 탭의 연도 하나만** 보인다(MAX 탭이면 그 해). 연도는 여기 「+ 연도 추가」로 더하고, 더하면 탭이 생긴다(사용자 지정 2026-11-09).
  box.innerHTML = fiscalYears.map((fy, i) => (i === activeYear ? `
    <span class="pf-fy-chip">
      <span class="pf-u">제</span>
      <input class="pf-input pf-num" data-fy-term="${i}" value="${esc(fy.term)}" placeholder="10" inputmode="numeric">
      <span class="pf-u">기 / 회계연도</span>
      <input class="pf-input pf-num" data-fy-year="${i}" value="${esc(fy.year)}" placeholder="2024" inputmode="numeric">
      ${fiscalYears.length > 1 ? `<button type="button" class="btn-icon btn-danger" data-fy-del="${i}" title="이 연도 삭제">✕</button>` : ''}
    </span>` : '')).join('')
    + (fiscalYears.length < MAX_FISCAL_YEARS ? '<button type="button" class="btn btn-ghost btn-sm" id="btnAddFy">+ 연도 추가</button>' : '');
  box.querySelectorAll('[data-fy-term]').forEach((el) => el.addEventListener('input', (e) => {
    fiscalYears[+e.target.dataset.fyTerm].term = e.target.value; renderYearTabs(); renderPersons(); recalc();
  }));
  box.querySelectorAll('[data-fy-year]').forEach((el) => el.addEventListener('input', (e) => {
    fiscalYears[+e.target.dataset.fyYear].year = e.target.value; renderYearTabs(); renderPersons(); recalc();
  }));
  box.querySelectorAll('[data-fy-del]').forEach((el) => el.addEventListener('click', (e) => {
    const idx = +e.currentTarget.dataset.fyDel;
    fiscalYears.splice(idx, 1);
    cases.splice(idx, 1);
    if (activeYear >= cases.length) activeYear = cases.length - 1;
    renderAll();
  }));
  const add = $('btnAddFy');
  if (add) add.addEventListener('click', addFiscalYear);
}

/* ── 1. 입력 ──────────────────────────────────────────────────────── */
function renderPersons() {
  if (maxMode && cases.length > 1) { renderPersonsAll(); return; }
  const c = cur();
  const cell = (i, f) => `<input class="pf-input${f === 'comp' ? ' pf-num' : ''}" data-p="${i}" data-f="${f}" type="text"
    ${f === 'comp' ? 'inputmode="numeric"' : ''} value="${f === 'comp' ? moneyStr(c.persons[i][f]) : esc(c.persons[i][f])}"
    placeholder="${f === 'name' ? '성명' : '원'}">`;
  $('personTable').innerHTML = `<thead><tr><th></th>${PERSON_ROLES.map((r) => `<th class="pf-c">${esc(r)}</th>`).join('')}</tr></thead>
    <tbody><tr id="personNameRow"><th>성명</th>${c.persons.map((p, i) => `<td>${cell(i, 'name')}</td>`).join('')}</tr>
    <tr id="personCompRow"><th>보수 등(원) <span class="pf-tip" data-tip="${esc(PERSON_TIP)}">ⓘ</span></th>${c.persons.map((p, i) => `<td>${cell(i, 'comp')}</td>`).join('')}</tr></tbody>`;
  $('personTable').querySelectorAll('[data-f="comp"]').forEach(wireMoneyBlur);
}
const PERSON_TIP = R.PERSON_BASE_FLOOR ? '감사인은 감사보수를 적습니다. 회사 관계자는 보수가 1억원 이하이거나 산출이 곤란하면 비워 두어도(성명만) 기준금액 1억원으로 셉니다.' : '감사인은 감사보수를 적습니다.';

/* MAX 탭 — 모든 연도를 한 표로(열 = 연도, 행 = 과징금 대상이 되는 임직원만). MAX 해의 칸은 노란색으로 강조한다(사용자 지정 2026-11-09). */
function renderPersonsAll() {
  const present = (p) => personPresent(p, R);
  let roles = PERSON_ROLES.filter((role) => cases.some((c) => present(c.persons.find((p) => p.role === role))));
  if (!roles.length) roles = PERSON_ROLES;   // 아직 아무도 적지 않았으면 다섯 모두
  // 한 표에 연도별 총보수만 보인다. 성명은 행 이름 옆에 「대표이사(성명)」처럼, 연도마다 다르면 「(갑, 을)」로 모아 보인다(고치는 것은 각 연도 탭).
  const labelOf = (role) => {
    const names = [...new Set(cases.map((c) => String((c.persons.find((p) => p.role === role) || {}).name || '').trim()).filter((n) => n && n !== role))];
    return names.length ? `${role}(${names.join(', ')})` : role;
  };
  const head = `<thead><tr><th>구분(성명) / 총보수(원) <span class="pf-tip" data-tip="${esc(PERSON_TIP)} 성명은 연도 탭에서 고칩니다.">ⓘ</span></th>${cases.map((c, y) =>
    `<th class="pf-c" data-ycol="${y}">${esc(fyLabel(fiscalYears[y], y))}</th>`).join('')}</tr></thead>`;
  const body = roles.map((role) => `<tr><th>${esc(labelOf(role))}</th>${cases.map((c, y) => {
    const i = c.persons.findIndex((p) => p.role === role);
    const p = c.persons[i];
    return `<td data-ycol="${y}"><input class="pf-input pf-num" data-y="${y}" data-p="${i}" data-f="comp" type="text" inputmode="numeric" value="${moneyStr(p.comp)}" placeholder="원"></td>`;
  }).join('')}</tr>`).join('');
  $('personTable').innerHTML = `${head}<tbody>${body}</tbody>`;
  $('personTable').querySelectorAll('[data-f="comp"]').forEach(wireMoneyBlur);
  paintMaxCells();
}

/* MAX 해의 열·행에 노란 표시를 입힌다(입력 중인 칸을 다시 그리지 않고 클래스만 바꾼다). */
function paintMaxCells() {
  document.querySelectorAll('[data-ycol]').forEach((el) => el.classList.toggle('pf-maxcell', maxMode && +el.dataset.ycol === lastMaxIdx));
  document.querySelectorAll('[data-yrow]').forEach((el) => el.classList.toggle('pf-maxcell', maxMode && +el.dataset.yrow === lastMaxIdx));
}

/* MAX 탭 — 기본정보: 연도별 한 표(기수·회계연도·중요성 기준금액·차감액). MAX 해의 줄은 노란색. */
function renderBasicAll() {
  const all = maxMode && cases.length > 1;
  document.querySelectorAll('.pf-f-mat, .pf-f-prior, .pf-f-fy').forEach((el) => { el.hidden = all; });
  $('basicAllWrap').hidden = !all;
  if (!all) return;
  $('basicAllTable').innerHTML = `<thead><tr><th class="pf-c">구분(기)</th><th class="pf-c">회계연도</th><th class="pf-c">중요성 기준금액(원)</th><th class="pf-c">기존 벌과금 등 차감액(원) <span class="pf-tip" data-tip="같은 사유로 이미 받은 벌금·과태료, 자본시장법상 과징금 부과액. 회사 과징금에서 뺍니다.">ⓘ</span></th><th></th></tr></thead>
    <tbody>${cases.map((c, y) => `<tr data-yrow="${y}">
      <td data-yrow="${y}" class="pf-c"><span class="pf-u">제</span><input class="pf-input pf-num pf-w44" data-ba="term" data-y="${y}" value="${esc(fiscalYears[y].term)}" inputmode="numeric"><span class="pf-u">기</span></td>
      <td data-yrow="${y}" class="pf-c"><input class="pf-input pf-num pf-w70" data-ba="year" data-y="${y}" value="${esc(fiscalYears[y].year)}" inputmode="numeric"></td>
      <td data-yrow="${y}"><input class="pf-input pf-num" data-ba="mat" data-y="${y}" value="${moneyStr(c.materiality)}" inputmode="numeric"></td>
      <td data-yrow="${y}"><input class="pf-input pf-num" data-ba="prior" data-y="${y}" value="${moneyStr(c.priorFine || 0)}" inputmode="numeric"></td>
      <td>${cases.length > 1 ? `<button type="button" class="btn-icon btn-danger" data-ba-del="${y}" title="이 연도 삭제">✕</button>` : ''}</td></tr>`).join('')}</tbody>`;
  $('basicAllTable').querySelectorAll('[data-ba="mat"],[data-ba="prior"]').forEach(wireMoneyBlur);
  paintMaxCells();
}
function onBasicAllInput(e) {
  const t = e.target; const y = +t.dataset.y;
  if (t.dataset.ba === 'term') fiscalYears[y].term = t.value;
  else if (t.dataset.ba === 'year') fiscalYears[y].year = t.value;
  else if (t.dataset.ba === 'mat') cases[y].materiality = parseMoney(t.value);
  else if (t.dataset.ba === 'prior') cases[y].priorFine = parseMoney(t.value);
  else return;
  renderYearTabs(); recalc();
}
function onPersonInput(e) {
  const y = e.target.dataset.y !== undefined ? +e.target.dataset.y : activeYear;   // MAX 탭의 전체 연도 표에서는 칸마다 연도가 있다
  const c = cases[y];
  const i = +e.target.dataset.p; const f = e.target.dataset.f;
  const was = availableRoles(c).includes(c.persons[i].role);
  c.persons[i][f] = f === 'comp' ? parseMoney(e.target.value) : e.target.value;
  // 보수를 적었는데 성명이 비어 있으면 역할 이름을 성명으로 채운다(대표이사·재무임원·담당임원·감사·감사인).
  if (f === 'comp' && c.persons[i].comp > 0 && !String(c.persons[i].name || '').trim()) {
    // 감사인은 해마다 같은 법인인 경우가 많아 「회계법인A」로 채운다(서로 다른 감사인이면 감사인1·감사인2…로 고쳐 쓴다).
    c.persons[i].name = c.persons[i].role === '감사인' ? '회계법인A' : c.persons[i].role;
    const nameInput = document.querySelector(`[data-p="${i}"][data-f="name"]${e.target.dataset.y !== undefined ? `[data-y="${y}"]` : ''}`);
    if (nameInput) nameInput.value = c.persons[i].name;
  }
  const now = availableRoles(c).includes(c.persons[i].role);
  if (was !== now) {
    // 새로 열린 사람은 회사 동기를 따르는 값으로 채운다(이미 고른 값이 있으면 둔다).
    if (now) for (const v of c.violations) if (!v.who[c.persons[i].role]) v.who[c.persons[i].role] = defaultWho(c.persons[i].role, v.motive, v.severe);
    fillWho(c);
    if (y === activeYear) { renderViolations(); renderAdjust(); renderReporter(); }
  }
  recalc();
}

/* 마우스를 올리면 칸 바로 위에 뜨는 짧은 설명(플로팅 메모) — 구·신 기준에서 무엇을 「상」으로 보는지(사용자 지정 2026-11-09). */
/* [[…]] 로 감싼 곳은 파랑(강조). (구) 화면은 (구) 기준의 「상」만 적고, (신) 화면은 (구)보다 더해진 항목을 파랑으로 보여 준다(사용자 지정 2026-11-09). */
const SEVERE_BASE = '· 자금 조성, 횡령·배임, 자금세탁, 불공정거래 연계';
const SEVERE_ADDED = '· [[가공 자산 계상·은폐 조작]]\n· [[장부·전표 위·변조]]\n· [[감사인 자료 위·변조]]';
const MEMO_WHO = [
  '고의·상 = 위법행위 내용 상(3점)',
  SEVERE_BASE,
  ...(MODE === 'new' ? [SEVERE_ADDED] : []),
  '※ 중과실은 항상 하(1점).',
].join('\n');
const OLD_SEVERE_WORDS = /횡령|배임|자금\s*세탁|자금\s*조성|불공정\s*거래|내부자\s*거래/;
const MEMO_SEVERE = [
  '상 = 위법행위 내용 상(3점) — 회사가 고의일 때만',
  SEVERE_BASE,
  ...(MODE === 'new' ? [SEVERE_ADDED, '※ 구 기준에서는 위반사항 이름에 횡령·배임·자금세탁 등이 있을 때만 상으로 셉니다.'] : []),
].join('\n');
let memoBox = null;
function wireMemo() {
  memoBox = document.createElement('div');
  memoBox.className = 'pf-memo-box'; memoBox.hidden = true;
  document.body.appendChild(memoBox);
  const hide = () => { memoBox.hidden = true; };
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('[data-memo]');
    if (!el) { hide(); return; }
    memoBox.innerHTML = esc(el.dataset.memo).replace(/\[\[(.+?)\]\]/g, '<b class="pf-memo-em">$1</b>');
    memoBox.hidden = false;
    const r = el.getBoundingClientRect(); const w = memoBox.offsetWidth; const h = memoBox.offsetHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    const top = r.top - h - 8 >= 4 ? r.top - h - 8 : r.bottom + 8;   // 바로 위, 자리가 없으면 아래
    memoBox.style.left = left + 'px'; memoBox.style.top = top + 'px';
  });
  document.addEventListener('mouseleave', hide);
  document.addEventListener('scroll', hide, true);
}

const MOTIVE_OPTS = ['고의', '중과실', '과실'];
const MARKET_OPTS = [['1', '하'], ['2', '중'], ['3', '상']];
function renderViolations() {
  const c = cur();
  const roles = availableRoles(c);
  const whoCell = (i, v, role) => {
    const on = roles.includes(role);
    // 막힌 칸은 값이 남아 있어도 비워 보인다. 예전에 저장된 「고의·상(신)」(고의상신)은 「고의·상」으로 보인다(둘을 화면에서 가르지 않는다).
    const val = on ? (v.who[role] === '고의상신' ? '고의상' : v.who[role]) || '' : '';
    const diff = on && val && val.replace('고의상신', '고의').replace('고의상', '고의') !== v.motive;   // 회사 동기와 다르면 연한 노란색
    return `<td class="pf-c"><select class="${diff ? 'pf-diff' : ''}" data-v="${i}" data-who="${role}" ${on ? '' : 'disabled'} ${on ? `data-memo="${esc(MEMO_WHO)}"` : ''}>
      <option value="">-</option>
      <option value="고의" ${val === '고의' ? 'selected' : ''}>고의</option>
      <option value="고의상" ${val === '고의상' ? 'selected' : ''}>고의·상</option>
      <option value="중과실" ${val === '중과실' ? 'selected' : ''}>중과실</option>
    </select></td>`;
  };
  $('violationRows').innerHTML = c.violations.map((v, i) => `
    <tr data-vrow="${i}" class="${v.motive === '과실' ? 'pf-off' : ''}">
      <td><input class="pf-input pf-desc" data-v="${i}" data-f="desc" value="${esc(v.desc)}" placeholder="예: 매출 과대계상" title="${esc(v.desc)}"></td>
      <td><input class="pf-input pf-num" data-v="${i}" data-f="amount" type="text" inputmode="numeric" value="${moneyStr(v.amount)}"></td>
      <td><select data-v="${i}" data-f="type">${['A', 'B', 'C', 'D'].map((t) => `<option ${v.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><select data-v="${i}" data-f="motive">${MOTIVE_OPTS.map((m) => `<option ${v.motive === m ? 'selected' : ''}>${m}</option>`).join('')}</select></td>
      <td class="pf-c"><select data-v="${i}" data-f="severe" ${v.motive === '고의' ? '' : 'disabled'} data-memo="${esc(MEMO_SEVERE)}">
        <option value="">-</option>
        <option value="true" ${v.severe ? 'selected' : ''}>상</option>
      </select></td>
      <td><input class="pf-input pf-mult" data-v="${i}" data-f="multiple" type="text" inputmode="decimal" value="${v.multiple || ''}" placeholder="자동"></td>
      <td><select data-v="${i}" data-f="market">${MARKET_OPTS.map(([k, t]) => `<option value="${k}" ${String(v.market) === k ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td class="pf-num pf-auto" data-auto="base:${v.id}">-</td>
      <td class="pf-auto pf-tip" data-auto="score:${v.id}" data-tip="">-</td>
      ${PERSON_ROLES.map((role) => whoCell(i, v, role)).join('')}
      <td><button type="button" class="btn-icon btn-danger" data-del="${i}" title="삭제">✕</button></td>
    </tr>`).join('');
  $('violationRows').querySelectorAll('[data-f="amount"]').forEach(wireMoneyBlur);
}
function onViolationInput(e) {
  const c = cur();
  const i = +e.target.dataset.v;
  const v = c.violations[i];
  if (e.target.dataset.who) {
    v.who[e.target.dataset.who] = e.target.value;
    renderViolations(); renderAdjust(); recalc();
    return;
  }
  const f = e.target.dataset.f;
  if (f === 'amount') v.amount = parseMoney(e.target.value);
  else if (f === 'severe') {
    // 화면에는 「-」「상」 둘뿐이다. 구 기준에서도 상인지(true)·신 기준에서만 상인지('new')는 어디서 골랐는지와 위반사항 이름으로 정한다 —
    // (구) 화면에서 고르면 구·신 모두 상, (신) 화면에서 고르면 이름에 횡령·배임·자금세탁·자금 조성·불공정거래·내부자거래가 있을 때만 구에서도 상.
    const oldSev = !!v.severe;
    v.severe = e.target.value === 'true' ? (MODE === 'old' || OLD_SEVERE_WORDS.test(v.desc || '') ? true : 'new') : false;
    followWho(c, v, v.motive, oldSev);   // 회사가 「고의·상」이면 대표·재무·담당도 「고의·상」, 상을 「-」로 바꾸면 같이 「고의」로
    renderAdjust(); renderViolations();
  }
  else if (f === 'market') v.market = +e.target.value;
  else if (f === 'multiple') v.multiple = parseFloat(String(e.target.value).replace(/[^0-9.]/g, '')) || 0;
  else if (f === 'motive') {
    const old = v.motive; const oldSev = !!v.severe;
    v.motive = e.target.value;
    if (v.motive !== '고의') v.severe = false;
    renderAdjust();
    followWho(c, v, old, oldSev);
    renderViolations();
  } else v[f] = e.target.value;
  recalc();
}

/** 계산 결과를 입력 표의 자동 칸에 채운다(입력 칸은 건드리지 않는다 — 커서가 튀지 않게). */
function paintAuto(res) {
  const byId = new Map(res.rows.map((r) => [r.v.id, r]));
  const ct = COMPANY_TYPES.find((t) => t.id === companyType) || COMPANY_TYPES[2];
  const level = ['', '하', '중', '상'];
  for (const v of cur().violations) {
    const r = byId.get(v.id);
    const base = document.querySelector(`[data-auto="base:${v.id}"]`);
    const score = document.querySelector(`[data-auto="score:${v.id}"]`);
    if (!base || !score) continue;
    if (!r) { base.textContent = '-'; score.textContent = v.motive === '과실' ? '대상 아님' : '-'; score.dataset.tip = ''; continue; }
    base.textContent = mil(r.base); base.title = `${num(r.base)}원`;
    score.innerHTML = scoreCell(r.tenths, r.rate);
    const mult = v.multiple > 0 ? ` ${v.multiple}배(입력)` : cur().materiality > 0 ? ` ${(r.base / cur().materiality).toFixed(1)}배` : '';
    score.dataset.tip = `내용 ${level[r.content]}(${r.content}) · 규모 ${level[r.scale]}(${r.scale})${mult} · 회사유형 ${level[ct.level]}(${ct.level}) · 시장 ${level[r.market]}(${r.market})`;
  }
  const raw = cur().violations.filter((v) => v.motive !== '과실').reduce((s, v) => s + (v.amount || 0), 0);
  const ms = cur().violations.filter((v) => v.motive !== '과실').reduce((a, v) => a + (Number(v.multiple) || 0), 0);
  const multSum = ms > 0 ? (Math.round(ms * 100) / 100).toString() : '';
  // 소계의 점수·적용률 — 위반사항이 여럿이면 줄마다 구한 점수를 기준금액으로 가중평균하고, 기본과징금 ÷ 기준금액을 적용률로 보인다.
  const tot = res.company.baseAmount;
  const subScore = tot > 0 ? scoreCell(res.rows.reduce((a, r) => a + r.base * r.tenths, 0) / tot, res.company.basic / tot) : '-';
  const subTip = res.rows.length > 1 ? '위반사항별 점수를 기준금액으로 가중평균한 점수와, 합산한 기본과징금 ÷ 기준금액(적용률)' : '';
  $('violationFoot').innerHTML = `<tr class="pf-foot">
    <td>합계 <span class="pf-u">(과실 제외)</span></td><td class="pf-num">${num(raw)}</td><td colspan="3"></td><td class="pf-num" title="같은 위반사항을 유형별로 나눈 줄의 위반규모(배) 합 — 이 배수로 위반규모 점수를 정합니다"><b>${multSum}</b></td><td></td>
    <td class="pf-num pf-auto" title="${num(res.company.baseAmount)}원"><b>${mil(res.company.baseAmount)}</b></td>
    <td class="pf-auto pf-tip" data-tip="${esc(subTip)}">${subScore}</td>
    <td colspan="6">회사 기본과징금 <b title="${num(res.company.basic)}원">${mil(res.company.basic)}</b> 백만원</td></tr>`;
}

/* ── 2. 가중·감경 ─────────────────────────────────────────────────── */
const ALL_PARTIES = PARTIES.map((p) => p.id);
const partyCols = () => ALL_PARTIES;
const hintAttr = `title="${R.PERSON_BASE_FLOOR ? '성명(감사인은 감사보수)을 입력하면 선택할 수 있습니다' : '보수를 입력하면 선택할 수 있습니다'}"`;
const isAvail = (p) => p === '회사' || availableRoles().includes(p);

function groupHeader(kind, gid, label, cols) {
  return `<tr class="pf-grp-head"><td colspan="3">${esc(label)}</td>
    ${cols.map((p) => `<td class="pf-c"><span class="pf-chip" data-chip="${kind}:${gid}:${p}"></span></td>`).join('')}</tr>`;
}

function reasonRow(kind, r, cols) {
  const store = kind === 'weight' ? cur().weight : cur().mitigate;
  const row = store[r.id];
  const anyOn = !!(row && Object.values(row.on || {}).some(Boolean));
  const groups = kind === 'weight' ? WEIGHT_GROUPS : MITIGATE_GROUPS;
  const cap = r.auto === 'period' ? '연도 기본과징금 합계' : r.cap ? `${r.cap}%` : r.group && groups[r.group].cap < 100 ? `그룹 ${groups[r.group].cap}%` : '율 직접';
  const anySevere = cur().violations.some((v) => v.motive === '고의' && (severeIn(R, v.severe) || Object.values(v.who).some((w) => severeIn(R, w))));
  // 율 칸: 규정이 율을 정해 둔 사유는 숫자만 보이고 고칠 수 없다. 나머지는 대상자 칸에서 따로 적는다.
  const rateCell = r.auto === 'period' ? '<span class="pf-u">자동 · 사업연도 수</span>'
    : r.auto ? (anySevere ? '<span class="pf-flag">상 표시 있음</span>' : '<span class="pf-u">자동</span>')
    : r.fixed ? `<b>${r.pct}%</b> <span class="pf-u">고정</span>`
      : `<span class="pf-u">${r.cap ? `${r.cap}% 이내` : '직접'} · 칸마다</span>`;
  const maxPct = r.cap || 100;
  let html = `<tr class="pf-reason ${anyOn ? 'pf-on' : ''}">
    <td><b>${esc(r.no)}</b> ${esc(r.label)} <span class="pf-tip" data-tip="${esc(r.tip)}">ⓘ</span></td>
    <td class="pf-c pf-lim">${esc(cap)}</td>
    <td class="pf-c pf-pctcell">${rateCell}</td>
    ${cols.map((p) => {
    const allowed = !r.parties || r.parties.includes(p);
    if (!allowed) return '<td class="pf-c pf-na"><span class="pf-u">·</span></td>';
    const avail = isAvail(p);
    // 위반기간 가중(신)은 기본으로 체크돼 있다(연도 수에 따라 율이 자동 계산) — 해제한 칸만 꺼진다.
    const autoOn = r.auto === 'period' && !!R.PERIOD && avail && !(row && row.on && row.on[p] === false);
    const on = !!(row && row.on && row.on[p]) || autoOn;
    const pctVal = row && row.pcts && row.pcts[p] !== undefined ? row.pcts[p] : (row && row.pct !== undefined ? row.pct : r.pct);
    const mini = (!r.fixed && !r.auto)
      ? `<input class="pf-mini" type="number" min="0" max="${maxPct}" data-pcts="${kind}:${r.id}:${p}" value="${pctVal ?? 0}" ${on ? '' : 'disabled'}><span class="pf-u">%</span>`
      : r.auto === 'period' ? `<span class="pf-u pf-pauto" data-pauto="${r.id}:${p}"></span>` : '';
    return `<td class="pf-c ${avail ? '' : 'pf-na'}" ${avail ? '' : hintAttr}>
      <span class="pf-cellbox"><input type="checkbox" data-chk="${kind}:${r.id}:${p}" ${on ? 'checked' : ''} ${avail ? '' : 'disabled'}>${mini}</span></td>`;
  }).join('')}
  </tr>`;
  if (r.free || r.reasonKind) {
    const samples = REASON_SAMPLES[r.reasonKind] || [];
    const pick = row && row.pick ? row.pick : '';
    const text = row && row.text ? row.text : '';
    html += `<tr class="pf-note-row" ${anyOn ? '' : 'hidden'}>
      <td colspan="${3 + cols.length}">
        <div class="pf-note">
          <select data-pick="${kind}:${r.id}">
            <option value="">사유 고르기 — 실사례</option>
            ${samples.map((s) => `<option ${pick === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
            <option ${pick === REASON_FREE ? 'selected' : ''}>${REASON_FREE}</option>
          </select>
          <textarea data-text="${kind}:${r.id}" rows="2" placeholder="○ 사건에 맞게 고쳐 쓰세요. 한글 파일의 사유 칸에 그대로 들어갑니다.">${esc(text)}</textarea>
        </div>
      </td></tr>`;
  }
  return html;
}

function adjustTable(kind) {
  const cols = partyCols();
  const reasons = kind === 'weight' ? WEIGHT_REASONS : MITIGATE_REASONS;
  const groups = kind === 'weight' ? WEIGHT_GROUPS : MITIGATE_GROUPS;
  let body = '';
  const seen = new Set();
  for (const r of reasons) {
    if (r.group && !seen.has(r.group)) {
      seen.add(r.group);
      body += groupHeader(kind, r.group, groups[r.group].label, cols);
    }
    if (!r.group && !seen.has('~')) {
      seen.add('~');
      body += `<tr class="pf-grp-head"><td colspan="3">사유별 한도</td>${cols.map(() => '<td></td>').join('')}</tr>`;
    }
    body += reasonRow(kind, r, cols);
  }
  return `<table class="pf-table pf-grid pf-adjust">
    <thead><tr><th>사유</th><th class="pf-c">한도</th><th class="pf-c">율</th>${cols.map((p) => `<th class="pf-c ${isAvail(p) ? '' : 'pf-na-h'}" ${isAvail(p) ? '' : hintAttr}>${esc(p)}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr class="pf-total-row"><td colspan="3">${kind === 'weight' ? `가중 합계 <span class="pf-u">(그룹·전체 한도 ${WEIGHT_TOTAL_CAP_PCT}% 적용 후${R.PERIOD && R.PERIOD_OUTSIDE_TOTAL_CAP ? ' · 위반기간 가중은 한도 밖' : ''})</span>` : '감경 합계 <span class="pf-u">(그룹 한도 적용 후 · 기본과징금까지)</span>'}</td>
      ${cols.map((p) => `<td class="pf-c ${isAvail(p) ? '' : 'pf-na'}"><b data-total="${kind}:${p}">-</b></td>`).join('')}</tr></tfoot></table>`;
}
function renderAdjust() {
  $('weightTable').innerHTML = adjustTable('weight');
  $('mitigateTable').innerHTML = adjustTable('mitigate');
}
function ensureRow(kind, id) {
  const store = kind === 'weight' ? cur().weight : cur().mitigate;
  const def = (kind === 'weight' ? WEIGHT_REASONS : MITIGATE_REASONS).find((r) => r.id === id);
  if (!store[id]) store[id] = { on: {}, pct: def.pct, pcts: {}, text: '', pick: '' };
  if (!store[id].pcts) store[id].pcts = {};
  return store[id];
}
function onAdjustChange(e) {
  const t = e.target;
  if (t.dataset.chk) {
    const [kind, id, party] = t.dataset.chk.split(':');
    const row = ensureRow(kind, id);
    row.on[party] = t.checked;
    // 회사를 처음 체크하면 같은 사유를 관계자·감사인 칸에도 기본으로 체크한다. 아니면 지우면 된다.
    if (t.checked && party === '회사' && !Object.entries(row.on).some(([p, on]) => on && p !== '회사')) {
      const def = (kind === 'weight' ? WEIGHT_REASONS : MITIGATE_REASONS).find((r) => r.id === id);
      for (const p of availableRoles()) if (!def.parties || def.parties.includes(p)) row.on[p] = true;
    }
    // 칸마다 따로 적는 율은 처음엔 사유 기본값으로 채운다.
    const dflt = (kind === 'weight' ? WEIGHT_REASONS : MITIGATE_REASONS).find((r) => r.id === id);
    for (const p of Object.keys(row.on)) if (row.pcts[p] === undefined) row.pcts[p] = dflt.pct;
    renderAdjust();
  } else if (t.dataset.pick !== undefined) {
    const [kind, id] = t.dataset.pick.split(':');
    const row = ensureRow(kind, id);
    row.pick = t.value;
    if (t.value && t.value !== REASON_FREE) row.text = t.value;
    if (t.value === REASON_FREE) row.text = '';
    renderAdjust();
  }
  recalc();
}
function onAdjustInput(e) {
  const t = e.target;
  if (t.dataset.pcts) {
    const [kind, id, party] = t.dataset.pcts.split(':');
    const def = (kind === 'weight' ? WEIGHT_REASONS : MITIGATE_REASONS).find((r) => r.id === id);
    ensureRow(kind, id).pcts[party] = Math.min(Math.max(+t.value || 0, 0), def.cap || 100);
  } else if (t.dataset.text) {
    const [kind, id] = t.dataset.text.split(':');
    ensureRow(kind, id).text = t.value;
  }
  recalc();
}

/** 그룹 한도 칩 — 그룹 합이 한도를 넘어 잘렸으면 붉게, 아니면 현재 율을 보인다. */
function paintChips(res) {
  const chipText = (g, party, kind) => {
    const r = res.parties[party];
    const part = r && r.applicable ? (kind === 'weight' ? r.weighting : r.mitigation) : null;
    const grp = part && part.groups[g];
    if (!grp || !r.basic) return { text: '', hit: false };
    const pct = Math.round((Math.min(grp.sum, grp.cap) / r.basic) * 100);
    const raw = Math.round((grp.sum / r.basic) * 100);
    return { text: grp.hit ? `${raw}% → ${pct}% 한도` : `${pct}%`, hit: grp.hit };
  };
  document.querySelectorAll('[data-chip]').forEach((el) => {
    const [kind, g, party] = el.dataset.chip.split(':');
    const { text, hit } = chipText(g, party, kind);
    el.textContent = text;
    el.classList.toggle('pf-hit', hit);
  });
  document.querySelectorAll('[data-pauto]').forEach((el) => {
    const [id, party] = el.dataset.pauto.split(':');
    const r = res.parties[party];
    const it = r && r.applicable ? r.weighting.items.find((x) => x.id === id) : null;
    el.textContent = it ? `${it.pct}%` : '';
    const pe = it && it.period;
    el.title = pe ? `고의 ${pe.years.intent}개 사업연도 · 중과실 ${pe.years.gross}개 사업연도 — 고의분 ${num(pe.intent)}원 + 중과실분 ${num(pe.gross)}원${pe.cap < pe.intent + pe.gross ? ` (연도 합계 한도 ${num(pe.cap)}원에서 잘림)` : ''}` : '';
  });
  document.querySelectorAll('[data-total]').forEach((el) => {
    const [kind, party] = el.dataset.total.split(':');
    const r = res.parties[party];
    if (!r || !r.applicable || !r.basic) { el.textContent = '-'; el.classList.remove('pf-hit'); return; }
    const part = kind === 'weight' ? r.weighting : r.mitigation;
    const pct = Math.round((part.total / r.basic) * 100);
    const rawPct = Math.round((part.rawTotal / r.basic) * 100);
    const cut = part.rawTotal > part.total;
    el.textContent = cut ? `${rawPct}% → ${pct}%` : `${pct}%`;
    el.classList.toggle('pf-hit', cut);
    el.title = cut ? '한도를 넘어 잘렸습니다' : '';
  });
  const total = (kind) => partyCols().map((p) => {
    const r = res.parties[p];
    if (!r || !r.applicable) return null;
    const part = kind === 'weight' ? r.weighting : r.mitigation;
    return `${p} ${r.basic ? Math.round((part.total / r.basic) * 100) : 0}%`;
  }).filter(Boolean).join(' · ');
  const wHit = Object.values(res.parties).some((r) => r.applicable && r.weighting.totalHit);
  $('weightSumBadge').textContent = `${total('weight') || '-'} · 합계 한도 ${WEIGHT_TOTAL_CAP_PCT}%${R.PERIOD && R.PERIOD_OUTSIDE_TOTAL_CAP ? '(위반기간 제외)' : ''}${wHit ? ' (한도 적용됨)' : ''}`;
  $('weightSumBadge').classList.toggle('pf-hit', wHit);
  $('mitigateSumBadge').textContent = `${total('mitigate') || '-'} · 기본과징금 한도`;
}

function renderReporter() {
  const cols = ['회사', ...availableRoles()];
  $('reporterTable').innerHTML = `<thead><tr><th>결정금액에서 감경(%)</th>${cols.map((p) => `<th class="pf-c">${esc(p)}</th>`).join('')}</tr></thead>
    <tbody><tr><td>신고·고지 <span class="pf-u">(0 = 없음 · ${REPORTER_MAX_PCT} 이내 · 100 = 면제)</span></td>
    ${cols.map((p) => `<td class="pf-c"><input class="pf-input pf-num" type="number" min="0" max="100" data-rep="${p}" value="${reporter[p] || 0}"></td>`).join('')}</tr></tbody>`;
}

/* ── 3. 결과 ──────────────────────────────────────────────────────── */
const partyKey = (d) => (d.kind === 'company' ? '회사' : d.party + (d.name && d.name !== d.party ? ' · ' + d.name : ''));

/** 이 화면의 기준(R)과 다른 기준(OTHER) 두 가지로 모두 센다 — 입력은 같다. (신)의 위반기간 가중은 해 전체를 보고 센다(`computeAll`). */
function computeAllYears() {
  const inputs = cases.map(inputOf);
  const labels = cases.map((c, i) => fyLabel(fiscalYears[i], i));
  const own = computeAll(inputs, R);
  const other = computeAll(inputs, OTHER);
  const perYear = own.map((result, i) => ({ label: labels[i], result }));
  const otherPerYear = other.map((result, i) => ({ label: labels[i], result }));
  const best = maxAcrossYears(perYear);
  const otherBest = maxAcrossYears(otherPerYear);
  const oldBest = MODE === 'old' ? best : otherBest;
  const newBest = MODE === 'new' ? best : otherBest;
  return { perYear, otherPerYear, best, otherBest, compare: compareBases(oldBest, newBest), multiYear: cases.length > 1 };
}

function renderSummary(all) {
  // 머리띠에는 **이 화면의 기준만** 보인다(구 화면 = 구, 신 화면 = 신) — 「구) 회사 X , 임직원 Y 백만원」. 합계는 보이지 않는다.
  // 구·신을 같이 보려면 이 칩을 누르거나 결과 단계의 「최종(연도별 중 최대)」 탭을 연다(사용자 지정 2026-11-09).
  // 회사·임직원 조치가 없고 감사인 조치만 있는 사건이면 감사인 금액을 보인다.
  const v = Object.values(all.best);
  const sum = (pick) => v.filter((x) => pick(x.data.kind)).reduce((a, x) => a + x.data.final, 0);
  const x = { company: sum((k) => k === 'company'), person: sum((k) => k === 'person'), auditor: sum((k) => k === 'auditor') };
  const auditorOnly = x.company + x.person === 0 && x.auditor > 0;
  const tag = MODE === 'new' ? '신' : '구';
  $('sumTotal').innerHTML = `<button type="button" class="pf-tot ${MODE === 'new' ? 'pf-tot-new-own' : 'pf-tot-old'} pf-tot-link" data-goto-cmp title="${tag} 기준으로 센 ${auditorOnly ? '감사인' : '회사와 임직원(감사인 제외)'} 금액 — 누르면 구·신을 같이 보는 비교표로 이동">${tag}) ${auditorOnly
    ? `감사인 <b>${mil(x.auditor)}</b>` : `회사 <b>${mil(x.company)}</b> , 임직원 <b>${mil(x.person)}</b>`}</button><span class="pf-unit">백만원</span>`;
  $('sumCards').innerHTML = x.company + x.person + x.auditor > 0 ? '' : '<span class="pf-u">과징금 대상이 없습니다</span>';
}

/** 산출 상세표의 행 정의. 한글 파일도 같은 것을 쓴다. */
function pivotModel(datas, priorFine) {
  const money = (v) => (v || v === 0 ? num(v) : '-');
  const signed = (v, sign) => (v ? sign + num(v) : '-');
  const rows = [
    ['1. 외감법상 과징금 한도', (d) => money(d.cap)],
    ['2. 과징금부과기준에 따른 과징금', (d) => money(d.adjusted)],
    ['(1) 기준금액', (d) => money(d.baseAmount), 'sub'],
    ['중요도 점수 · 부과기준율', (d) => (d.kind === 'company' ? '위반사항별' : `${scoreText(d.tenths)} · ${pctText(d.rate)}`), 'sub'],
    ['(2) 기본과징금', (d) => money(d.basic), 'sub'],
    ['(3) 가중', (d) => signed(d.weighting.total, '+'), 'sub'],
    ['(4) 감경', (d) => signed(d.mitigation.total, '-'), 'sub'],
    ['3. 과징금부과액 min(1, 2)', (d) => money(d.imposed)],
    ['4. 기처분 벌금·과태료 등', (d) => (d.kind === 'company' && priorFine ? num(priorFine) : '-')],
    ['5. 10만원 단위 절사', (d) => {
      const cut = d.imposed - (d.kind === 'company' ? priorFine : 0) - d.decided;
      return cut > 0 ? num(cut) : '-';
    }],
    ['6. 과징금부과 결정액', (d) => num(d.decided), 'total'],
  ];
  if (datas.some((d) => d.reporterPct > 0)) {
    rows.push(['7. 신고자 감경', (d) => (d.reporterPct ? `${d.reporterPct >= 100 ? '면제' : '-' + d.reporterPct + '%'}` : '-')]);
    rows.push(['8. 최종 부과액', (d) => num(d.final), 'total']);
  }
  return rows.map(([label, fn, cls]) => ({ label, cells: datas.map(fn), cls }));
}

let lastPivot = null;
function renderPivot(entries, priorFine, own = true) {
  const datas = entries.map((e) => e.data);
  if (!datas.length) { if (own) lastPivot = null; return '<div class="pf-empty">과징금 대상이 없습니다.</div>'; }
  const model = pivotModel(datas, priorFine);
  if (own) lastPivot = [['산정 내역', ...entries.map((e) => e.key)], ...model.map((r) => [r.label, ...r.cells])];
  return `<div class="pf-card"><h3>과징금 산출 상세 <span class="pf-u">(단위 : 원)</span></h3>
    <div class="pf-tablewrap"><table class="pf-table pf-pivot">
      <thead><tr><th>산정 내역</th>${entries.map((e) => `<th>${esc(e.key)}<div class="pf-u">${esc(e.data.motive)}</div></th>`).join('')}</tr></thead>
      <tbody>${model.map((r) => `<tr class="${r.cls ? 'pf-' + r.cls : ''}"><td>${esc(r.label)}</td>${r.cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div></div>`;
}

function renderDetails(result) {
  const rows = result.rows;
  const level = ['', '하', '중', '상'];
  const vio = rows.length ? `<div class="pf-card"><h3>위반사항별 위법행위 중요도 (회사)</h3>
    <div class="pf-tablewrap"><table class="pf-table"><thead><tr><th>위반사항</th><th>유형</th><th>동기</th><th class="pf-r">기준금액</th>
      <th class="pf-c">내용</th><th class="pf-c">규모</th><th class="pf-c">회사유형</th><th class="pf-c">시장</th><th class="pf-c">점수</th><th class="pf-c">율</th><th class="pf-r">기본과징금</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.v.desc || '-')}</td><td>${esc(r.v.type)}</td><td>${esc(r.v.motive)}</td><td class="pf-r">${num(r.base)}</td>
        <td class="pf-c">${level[r.content]}</td><td class="pf-c">${level[r.scale]}</td><td class="pf-c">${level[r.typeLevel]}</td><td class="pf-c">${level[r.market]}</td>
        <td class="pf-c">${scoreText(r.tenths)}</td><td class="pf-c">${pctText(r.rate)}</td><td class="pf-r">${num(r.basic)}</td></tr>`).join('')}</tbody></table></div></div>` : '';
  return vio;
}

/* ── 구·신 비교 ────────────────────────────────────────────────────
 * 같은 입력을 (구)·(신) 두 기준으로 센 결과를 대상자별로 나란히 두고, 달라진 칸은 노란색으로 보인다.
 * 마지막 줄은 피조치자에게 유리한(적은) 금액 — 이것이 결정액이다. 어디서 달라졌는지 원인도 한 줄로 적는다. */
const CHANGES = [
  ['1.나', '회사관계자 기준금액 — 회사집단·받기로 한 이익·확정된 횡령배임액까지 포함, 산출 곤란이거나 1억원 이하이면 1억원'],
  ['2.라', '위법행위 내용 「상」 확대 — 가공 자산 계상·은폐 조작, 장부 위·변조, 감사인 요구자료 위·변조가 중(2점)에서 상(3점)으로'],
  ['3.가.2)', '위반기간 가중 신설 — 고의 30%×(위반 사업연도 수−1), 중과실 20%×(수−2), 각 사업연도 기본과징금 합계 이내 (구 「3개 사업연도 초과 30%」 대체)'],
  ['3.나.3) 라)', '감경 신설 — 경영진 교체 후 신속한 조사·정정·책임임원 교체·감리 협조'],
];
function diffReasons(o, n) {
  if (!o || !n) return '';
  const why = [];
  const od = o.data; const nd = n.data;
  if (od.baseAmount !== nd.baseAmount) why.push('기준금액 1억 하한');
  if (od.kind === 'company' ? od.basic !== nd.basic : od.tenths !== nd.tenths) why.push('「상」 범위(2.라)');
  const pw = (d) => d.weighting.items.filter((x) => x.id === 'w3').reduce((a, x) => a + x.amount, 0);
  if (pw(od) !== pw(nd)) why.push('위반기간 가중(3.가.2)');
  const mt = (d) => d.mitigation.items.filter((x) => x.id === 'm12').reduce((a, x) => a + x.amount, 0);
  if (mt(od) !== mt(nd)) why.push('감경 라)');
  if (!why.length && od.final !== nd.final) why.push('한도·연동 금액');
  return why.join(' · ');
}
function renderCompare(all) {
  const cmp = all.compare;
  if (!cmp.length) return '';
  const rowDefs = [
    ['기준금액', (d) => d.baseAmount, num],
    ['점수 → 율', (d) => (d.kind === 'company' ? '위반사항별' : `${scoreText(d.tenths)} → ${pctText(d.rate)}`), (v) => v],
    ['기본과징금', (d) => d.basic, num],
    ['가중', (d) => d.weighting.total, (v) => (v ? '+' + num(v) : '-')],
    ['감경', (d) => d.mitigation.total, (v) => (v ? '-' + num(v) : '-')],
    ['한도', (d) => d.cap, num],
    ['결정 금액', (d) => d.final, num, 'total'],
  ];
  // 하나의 표: 산정 내역 | (구) 위반행위 발생당시 | (신) 현행. 대상자마다 한 묶음(회사·임직원·감사인)이고, (신)이 더 유리한 대상자의 (신) 칸은 노랑.
  const body = cmp.map((c) => {
    const newBetter = c.pick === 'new';
    const cells = (side, mark) => (label, get, fmt) => {
      const d = c[side] ? get(c[side].data) : null;
      return `<td class="pf-r ${mark ? 'pf-diff' : ''}">${d === null ? '<span class="pf-u">산정 불가</span>' : esc(fmt(d))}</td>`;
    };
    const tag = c.only ? (c.pick === 'new' ? '(신)만 산정' : '(구)만 산정') : c.newFinal === c.oldFinal ? '동일' : c.pick === 'new' ? '(신) 유리' : '(구) 유리';
    return `<tr class="pf-cmp-party"><th colspan="3">${esc(c.key)} <span class="pf-u">— ${tag}</span></th></tr>`
      + rowDefs.map(([label, get, fmt, cls]) => `<tr class="${cls ? 'pf-' + cls : ''}"><td>${esc(label)}</td>${cells('old', false)(label, get, fmt)}${cells('new', newBetter)(label, get, fmt)}</tr>`).join('');
  }).join('');
  // 피조치자에게 유리한 기준 — 대부분의 기준을 한 줄로, 다른 기준이 유리한 대상자는 문구로 덧붙인다.
  const newBetter = cmp.filter((c) => c.pick === 'new' && !c.only);
  const oldBetter = cmp.filter((c) => c.pick === 'old' && !c.only && c.oldFinal !== c.newFinal);
  const names = (arr) => arr.map((c) => c.key.replace(' · ', ' ')).join(', ');
  let verdict;
  if (!newBetter.length) verdict = '(구) 기준이 유리합니다' + (oldBetter.length ? '' : ' (구·신 동일)');
  else if (!oldBetter.length) verdict = '(신) 기준이 유리합니다';
  else verdict = `(구) 기준이 유리합니다 — 다만 ${names(newBetter)}은(는) (신) 기준이 유리합니다`;
  const total = cmp.reduce((a, c) => a + c.final, 0);
  return `<div class="pf-card pf-cmp"><h3>비교양정 <span class="pf-guide">같은 입력을 (구) 위반행위 발생당시 기준과 (신) 현행 기준으로 세어 비교합니다</span>
      <span class="pf-badge pf-b-new">결정 합계 ${num(total)}원</span></h3>
    <div class="pf-tablewrap"><table class="pf-table pf-pivot pf-cmp-table">
      <thead><tr><th>산정 내역 <span class="pf-u">(단위 : 원)</span></th><th class="pf-c">(구) 기준<div class="pf-u">위반행위 발생당시</div></th><th class="pf-c">(신) 기준<div class="pf-u">현행</div></th></tr></thead>
      <tbody>${body}
        <tr class="pf-total pf-decide-row"><td>피조치자에게 유리한 기준</td><td colspan="2" class="pf-c"><b>${esc(verdict)}</b></td></tr></tbody></table></div>
    <details class="pf-changes"><summary>(구) → (신) 바뀐 곳 보기</summary>
      <ul>${CHANGES.map(([k, t]) => `<li><b>별표8 ${esc(k)}</b> ${esc(t)}</li>`).join('')}</ul></details></div>`;
}

/** 최종 부과액 표 — 대상자별로 (구)·(신) 결정금액과 유리한 기준·결정액. */
function renderFinal(all) {
  const cmp = all.compare;
  if (!cmp.length) return '<div class="pf-empty">과징금 대상이 없습니다.</div>';
  const tag = (c) => (c.only ? (c.pick === 'new' ? '(신)만 산정' : '(구)만 산정') : c.newFinal === c.oldFinal ? '동일' : c.pick === 'new' ? '(신) 유리' : '(구) 유리');
  return `<div class="pf-tablewrap"><table class="pf-table pf-pivot"><thead><tr><th>대상자</th><th>(구) 기준</th><th>(신) 기준</th><th>유리한 기준</th><th>최종 부과액</th></tr></thead>
    <tbody>${cmp.map((c) => `<tr><td>${esc(c.key)}</td><td>${c.oldFinal === null ? '산정 불가' : num(c.oldFinal)}</td><td>${c.newFinal === null ? '산정 불가' : num(c.newFinal)}</td><td>${tag(c)}</td><td><b>${num(c.final)}</b></td></tr>`).join('')}
    <tr class="pf-total"><td>합계</td><td></td><td></td><td></td><td>${num(cmp.reduce((a, c) => a + c.final, 0))}</td></tr></tbody></table></div>`;
}

/* 3. 결과 — 이 화면의 기준 내역은 펼쳐 두고, 다른 기준과 최종 부과액은 접어 둔다(사용자 지정 2026-11-09). 가운데 「비교양정」을 누르면 (구)·(신)을 한 표로 비교한다. */
const accOpen = { old: MODE === 'old', new: MODE === 'new', fin: false, cmp: false };
function renderResult(all) {
  if (!all.multiYear) resultView = 'max';
  const view = resultView === 'max' || !all.multiYear ? 'max' : resultView;
  const priorFine = view === 'max' ? Math.max(...cases.map((c) => c.priorFine || 0)) : (cases[view].priorFine || 0);
  const basis = (side) => {
    const own = side === MODE;
    const perYear = own ? all.perYear : all.otherPerYear;
    const best = own ? all.best : all.otherBest;
    let entries; let detail = '';
    if (view === 'max') {
      entries = Object.entries(best).map(([key, v]) => ({ key, data: v.data }));
      if (perYear.length === 1) detail = renderDetails(perYear[0].result);
    } else {
      const r = perYear[view].result;
      entries = Object.values(r.parties).filter((d) => d.applicable).map((d) => ({ key: partyKey(d), data: d }));
      detail = renderDetails(r);
    }
    return renderPivot(entries, priorFine, own) + detail;
  };
  const acc = (id, title, inner, openNow) => `<details class="pf-acc" data-acc="${id}" ${openNow ? 'open' : ''}><summary>${title}</summary>${inner}</details>`;
  const sides = MODE === 'new' ? ['new', 'old'] : ['old', 'new'];
  const label = { old: '(구) 기준 — 위반행위 발생당시', new: '(신) 기준 — 현행' };
  const html = sides.map((sd) => acc(sd, `${label[sd]} 산출 내역${sd === MODE ? ' <span class="pf-u">— 이 화면의 기준</span>' : ''}`, basis(sd), accOpen[sd])).join('')
    + (view === 'max' ? `<div class="pf-cmpbar"><button type="button" class="btn btn-sm ${accOpen.cmp ? 'btn-primary' : ''}" data-cmp-toggle>비교양정 ${accOpen.cmp ? '▲' : '▼'}</button></div>`
      + (accOpen.cmp ? renderCompare(all) : '') : '')
    + (view === 'max' ? acc('fin', '최종 부과액 <span class="pf-u">MIN[(구), (신)] — 피조치자에게 유리한 금액</span>', renderFinal(all), accOpen.fin) : '');
  $('resultDetail').innerHTML = html;
}

function copyResult() {
  if (!lastPivot) { toast('복사할 결과가 없습니다.', 'err'); return; }
  const tsv = lastPivot.map((r) => r.join('\t')).join('\n');
  (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(tsv) : Promise.reject(new Error('x')))
    .then(() => toast('결과표를 복사했습니다 — 엑셀·한글에 붙여넣기 하세요.'))
    .catch(() => toast('복사에 실패했습니다. 브라우저 권한을 확인하세요.', 'err'));
}

/* ── 한글(hwpx) ───────────────────────────────────────────────────
 * 실사례 한글(증선위 보고 붙임 「과징금 산정내역」)과 같은 짜임으로 만든다 — 내용은 `penalty_fine_report.js`,
 * 파일은 `penalty_fine_hwpx.js`. 화면의 결과와 같은 셈(`computeYear`)을 그대로 쓴다. */
function exportHwpx() {
  const all = computeAllYears();
  if (!Object.keys(all.best).length) { toast('내려받을 결과가 없습니다. 위반사항과 금액을 먼저 입력하세요.', 'err'); return; }
  try {
    const years = all.perYear.map((py, i) => ({ term: fiscalYears[i].term, year: fiscalYears[i].year, label: py.label, materiality: cases[i].materiality, result: py.result }));
    const type = COMPANY_TYPES.find((t) => t.id === companyType) || COMPANY_TYPES[2];
    const blocks = buildReport(years, {
      priorFine: Math.max(...cases.map((c) => c.priorFine || 0)),
      reporter: Object.values(reporter).some((v) => v > 0),
      companyTypeLabel: type.label,
      rules: R,
      compare: all.compare,
    });
    const bytes = buildHwpx(blocks, { title: '과징금 산정내역' });
    const d = new Date();
    const stamp = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    download(bytes, `${stamp}_과징금_산정내역(${R.tag}).hwpx`);
    toast('한글 파일을 만들었습니다.');
  } catch (err) {
    toast('한글 파일을 만들지 못했습니다: ' + (err && err.message ? err.message : err), 'err');
  }
}

/* ── 재계산 ───────────────────────────────────────────────────────── */
function recalc() {
  const all = computeAllYears();
  const mx = pickMaxYear(all.perYear);
  if (mx !== lastMaxIdx) { lastMaxIdx = mx; if (currentSec !== 'result') renderYearTabs(); paintMaxCells(); }   // MAX 탭에 적힌 연도만 갱신(입력 중이던 칸은 건드리지 않는다)
  paintAuto(all.perYear[activeYear].result);
  paintChips(all.perYear[activeYear].result);
  renderSummary(all);
  renderResult(all);
  saveState();
}

/* ── 이 브라우저에 입력내용 저장 (서버에는 저장하지 않음) ────────────── */
const LS_KEY = 'kamp_gwajingeum_v2';
/* [초기화]로 비운 상태인가 — 저장된 빈 사건이 「입력한 적 없음」(→ 예제를 연다)인지 「사용자가 일부러 비움」인지 가른다. */
let userBlank = false;
let sampleId = '';   // 저장된 입력이 어느 예제에서 온 것인가(예제가 바뀌면 예전 예제를 새 예제로 바꾸는 데 쓴다)
const hasAnyInput = () => cases.some((c) => c.violations.some((v) => (v.amount || 0) > 0) || c.persons.some((p) => (p.comp || 0) > 0 || String(p.name || '').trim()));
let suppressSave = false;   // 다른 화면에서 온 값으로 다시 그리는 동안은 저장하지 않는다(서로 번갈아 저장하며 입력을 방해하는 것을 막는다)
function saveState() {
  if (suppressSave) return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ blank: userBlank && !hasAnyInput(), sampleId, companyType, priorFine: cur() ? cur().priorFine || 0 : 0, reporter, fiscalYears, cases, activeYear }));
  } catch (e) { /* 저장 공간이 없어도 화면 동작에는 지장 없음 */ }
}
/** 저장 모양의 객체 하나를 화면 상태로 들인다. 모양이 코드가 기대하는 것과 다르면 false. */
function applyState(s) {
  if (!s || !Array.isArray(s.cases) || !s.cases.length) return false;
  userBlank = !!s.blank;
  sampleId = s.sampleId || '';
  for (const c of s.cases) {
    if (!Array.isArray(c.persons) || !Array.isArray(c.violations) || typeof c.weight !== 'object' || typeof c.mitigate !== 'object') return false;
  }
  companyType = COMPANY_TYPES.some((t) => t.id === s.companyType) ? s.companyType : 'general';
  reporter = s.reporter || {};
  fiscalYears = s.fiscalYears && s.fiscalYears.length ? s.fiscalYears : [{ term: '', year: '' }];
  cases = s.cases;
  activeYear = Math.min(Math.max(s.activeYear || 0, 0), cases.length - 1);
  for (const c of cases) if (c.priorFine === undefined) c.priorFine = s.priorFine || 0;   // 예전 저장값(사건 하나에 하나)은 모든 연도에 같이 둔다
  let maxId = 0;
  for (const c of cases) for (const v of c.violations) maxId = Math.max(maxId, v.id || 0);
  vidSeq = maxId + 1;
  return true;
}
function restoreState() {
  // 구조가 바뀌면 저장된 모양이 코드가 기대하는 것과 달라진다. 예외로 화면이 멈추지 않게 통째로 감싸고,
  // 실패하면 깨진 저장값을 지우고 새로 시작한다.
  try {
    return applyState(JSON.parse(localStorage.getItem(LS_KEY) || 'null'));
  } catch (e) {
    try { localStorage.removeItem(LS_KEY); } catch (e2) { /* ignore */ }
    return false;
  }
}

/** 예제(사례 5)를 들인다. 꺼 두었으면 빈 새 사건. */
function loadExample() {
  if (EXAMPLE_ON && applyState(sampleState())) { sampleId = EXAMPLE_ID; return true; }
  blankCase();
  return false;
}
function blankCase() {
  companyType = 'general'; reporter = {}; fiscalYears = [{ term: '', year: '' }];
  cases = [newYearCase()];
  for (let i = 0; i < 2; i++) cases[0].violations.push(newViolation());
  activeYear = 0; vidSeq = cases[0].violations.reduce((m, v) => Math.max(m, v.id), 0) + 1;
  $('priorFine').value = ''; cases[0].priorFine = 0;
}

/* ── 그리기·연결 ──────────────────────────────────────────────────── */
function renderAll() {
  const c = cur();
  $('companyType').value = companyType;
  $('materiality').value = moneyStr(c.materiality);
  $('priorFine').value = moneyStr(c.priorFine || 0);
  fillWho(c);
  renderFiscalYears();
  renderBasicAll();
  renderYearTabs();
  renderPersons();
  renderViolations();
  renderAdjust();
  renderReporter();
  recalc();
}

function switchSection(id) {
  currentSec = id;
  renderYearTabs();
  document.querySelectorAll('.pf-steps button').forEach((b) => b.classList.toggle('active', b.dataset.sec === id));
  document.querySelectorAll('.pf-sec').forEach((s) => s.classList.toggle('active', s.id === 'sec-' + id));
}

function init() {
  // ⚠️ 개정 표시의 **유일한 출처**는 `penalty_fine_rules.js` 다. 화면에 글자를 두면 기준을 고칠 때
  //    두 곳을 같이 고쳐야 하고, 반드시 한쪽만 고쳐져 갈린다.
  $('pf-rev').textContent = REVISION;
  $('pf-rev').title = REVISION_DETAIL;
  $('companyType').innerHTML = COMPANY_TYPES.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('');
  // 이 PC 브라우저에 저장된 입력이 있으면 그것을, 없으면 예제(사례 5)를 연다. 서버에는 아무것도 저장하지 않는다.
  // 저장된 것이 **빈 사건**이어도 [초기화]로 일부러 비운 것이면 그대로 비워 둔다. 입력한 적 없이 저장된 빈 상태면 예제를 연다.
  // 예제를 고친 뒤에도 예전 예제가 저장돼 있으면(금액·유형은 예제와 같고 위반규모(배)만 다르면) 새 예제로 바꾼다.
  const staleExample = () => EXAMPLE_ON && ((sampleId && sampleId !== EXAMPLE_ID) || (!sampleId && looksLikeOldExample(cases)));
  const restored = restoreState();
  if (restored && hasAnyInput() && staleExample()) { loadExample(); toast(`예제가 바뀌어 새 예제(${EXAMPLE_NAME})로 바꿨습니다. 이전 시험 값은 지워졌습니다.`); }
  // (예전 예제 시절에 비운 상태 = sampleId 없음 은 새 예제로 한 번 바꾼다)
  else if (restored && (hasAnyInput() || (userBlank && sampleId === EXAMPLE_ID))) { if (hasAnyInput()) toast('이 브라우저에 저장된 이전 입력내용을 불러왔습니다. 모두 지우려면 [초기화]를 누르세요.'); }
  else if (loadExample()) toast(`예제를 불러왔습니다 — ${EXAMPLE_NAME}. 입력을 고치면 이 브라우저에 저장됩니다.`);

  $('companyType').addEventListener('change', (e) => { companyType = e.target.value; recalc(); });
  $('priorFine').addEventListener('input', (e) => { cur().priorFine = parseMoney(e.target.value); recalc(); });
  wireMoneyBlur($('priorFine'));
  $('materiality').addEventListener('input', (e) => { cur().materiality = parseMoney(e.target.value); recalc(); });
  wireMoneyBlur($('materiality'));
  $('btnAddFyTop').addEventListener('click', addFiscalYear);
  $('btnAddViolation').addEventListener('click', () => { cur().violations.push(newViolation()); fillWho(cur()); renderViolations(); recalc(); });

  wireMemo();
  $('basicAllTable').addEventListener('input', onBasicAllInput);
  $('basicAllTable').addEventListener('click', (e) => {
    const d = e.target.closest('[data-ba-del]');
    if (!d) return;
    const idx = +d.dataset.baDel;
    fiscalYears.splice(idx, 1); cases.splice(idx, 1);
    if (activeYear >= cases.length) activeYear = cases.length - 1;
    if (cases.length < 2) maxMode = false;
    renderAll();
  });
  $('personTable').addEventListener('input', onPersonInput);
  $('violationRows').addEventListener('input', onViolationInput);
  $('violationRows').addEventListener('change', onViolationInput);
  $('violationRows').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    cur().violations.splice(+del.dataset.del, 1);
    renderViolations(); recalc();
  });
  for (const id of ['weightTable', 'mitigateTable']) {
    $(id).addEventListener('change', onAdjustChange);
    $(id).addEventListener('input', onAdjustInput);
  }
  $('reporterTable').addEventListener('input', (e) => {
    const p = e.target.dataset.rep;
    if (!p) return;
    reporter[p] = Math.min(Math.max(+e.target.value || 0, 0), 100);
    recalc();
  });
  $('btnCopyResult').addEventListener('click', copyResult);
  // 결과 단계의 접기·펼치기 상태를 기억하고(다시 그려도 유지), 「비교양정」으로 구·신 비교표를 연다.
  $('resultDetail').addEventListener('toggle', (e) => { const d = e.target.closest && e.target.closest('details[data-acc]'); if (d) accOpen[d.dataset.acc] = d.open; }, true);
  $('resultDetail').addEventListener('click', (e) => {
    if (!e.target.closest('[data-cmp-toggle]')) return;
    accOpen.cmp = !accOpen.cmp; recalc();
  });
  // 머리띠의 「(구/신) 기준」·「유리 결정」 칩을 누르면 결과 단계의 구·신 비교표로 간다.
  $('sumTotal').addEventListener('click', (e) => {
    if (!e.target.closest('[data-goto-cmp]')) return;
    resultView = 'max'; accOpen.cmp = true;
    switchSection('result'); renderYearTabs(); recalc();
    const card = document.querySelector('.pf-cmp');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else document.querySelector('.pf-center').scrollTo({ top: 0, behavior: 'smooth' });
  });
  // 초기화: 이 브라우저에 입력된 **모든 정보를 지워 빈 상태**로 만든다(예제로 되돌리지 않는다, 사용자 지정 2026-11-09).
  $('btnReset').addEventListener('click', () => {
    if (!window.confirm('입력한 모든 정보를 지우고 빈 상태로 초기화합니다. 계속할까요?')) return;
    resultView = 'max'; maxMode = false;
    blankCase(); userBlank = true; sampleId = EXAMPLE_ID; switchSection('input'); renderAll();
    toast('모든 입력을 지웠습니다.');
  });
  // 같은 입력을 다른 기준 화면에서 보기 — 포털 안이면 메뉴를 옮기고(왼쪽 메뉴 표시도 따라가게), 단독 주소면 그 화면으로 간다.
  $('btnOther').addEventListener('click', () => {
    const { code, href } = $('btnOther').dataset;
    // 넘어간 화면은 바로 결과 단계의 「구·신 기준 비교」 표를 연다 — 대상자별로 (구 발생당시)·(신 현행) 금액이 나란히 보인다.
    try { sessionStorage.setItem('pf_open_cmp', '1'); } catch (e) { /* 저장 못 해도 이동은 한다 */ }
    try { if (window.parent !== window && window.parent.location.origin === location.origin) { window.parent.location.hash = '#menu=' + code; return; } } catch (e) { /* 단독 */ }
    window.location.href = href;
  });
  $('btnHwpx').addEventListener('click', exportHwpx);

  // 글자 크기: 조절 단추는 없앴다(머리띠가 좁다, 사용자 지정 2026-11-09). 예전 기본(100%)보다 한 단계 큰 107% 로 연다.
  document.querySelector('.pf-shell').style.zoom = '107%';

  document.querySelectorAll('.pf-steps button').forEach((b) => b.addEventListener('click', () => {
    switchSection(b.dataset.sec);
    document.querySelector('.pf-center').scrollTo({ top: 0, behavior: 'smooth' });
  }));
  $('btnTop').addEventListener('click', () => document.querySelector('.pf-center').scrollTo({ top: 0, behavior: 'smooth' }));

  // 다른 주소(구↔신)에서 입력을 고치면 이쪽도 따라간다 — 두 화면이 같은 저장소 칸을 쓴다.
  // `storage` 사건은 **다른 문서에서 값이 바뀔 때만** 온다(같은 값을 다시 쓰면 안 온다) — 그래서 도돌이가 없다.
  // ⚠️ 지금 **입력 중인(초점이 있는) 화면은 받지 않는다** — 구·신 두 화면이 서로 저장하고 다시 그리면 입력하는 도중 칸이 다시 그려져 수정이 안 된다.
  //    초점이 없는(보이지 않는) 화면만 받아 갱신하고, 그때는 되저장하지 않는다.
  window.addEventListener('storage', (e) => {
    if (e.key !== LS_KEY || document.hasFocus()) return;
    if (restoreState()) { suppressSave = true; try { renderAll(); } finally { suppressSave = false; } }
  });

  renderAll();
  let openCmp = false;
  try { openCmp = sessionStorage.getItem('pf_open_cmp') === '1'; sessionStorage.removeItem('pf_open_cmp'); } catch (e) { /* 없으면 입력 단계 */ }
  if (openCmp) {
    switchSection('result');
    const card = document.querySelector('.pf-cmp');
    if (card) card.scrollIntoView({ block: 'start' });
  }
}

/* ⚠️ 모듈 스크립트는 defer 라 이 줄이 도는 시점에 DOM 이 이미 서 있다.
   `DOMContentLoaded` 를 기다리면 그 사건이 지나간 뒤라 영영 안 돈다. */
init();

