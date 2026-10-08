/* [통합조회] 가 함께 쓰는 잔손 — 표 그리기·복사·쪽 나누기·조회 대상 카드 접기.
 *
 * 수입신고필증·특허권·예비심사기업·환율금리(2026-09-03).
 * 카드 접기만은 `lookup.js` 도 함께 쓴다(그 카드의 주인이라서).
 *
 * ## 왜 모았나
 *
 * `nts.js` 와 `rehab.js` 에는 `escapeHtml`·`showToast`·표 복사가 **각자 한 벌씩**
 * 들어 있다. 둘일 때는 견딜 만했지만 여섯이 되면 같은 함수가 여섯 벌이 되고,
 * 그러면 반드시 한쪽만 고쳐져 갈린다 — 이 저장소가 이미 겪은 종류의 고장이다.
 * 새로 만드는 넷은 여기서 가져다 쓴다.
 *
 * ⚠️ `nts.js`·`rehab.js` 는 **건드리지 않았다.** 잘 돌던 화면을 이 정리 때문에
 *    함께 손대면, 무언가 깨졌을 때 새 화면 탓인지 정리 탓인지 가릴 수 없다.
 *
 * ## 여기 있는 것과 없는 것
 *
 * 있는 것은 **어느 조회에나 같은 모양으로 나오는 것**뿐이다. 표를 그리고,
 * 표를 탭으로 복사하고, 쪽을 나누고, 실패를 사람 말로 옮긴다.
 * 각 조회가 무엇을 묻고 무엇을 받는지는 그 화면의 파일에 있다.
 */
import { ApiError } from './api.js';
import { companyLabel } from './company.js';

export const $ = (id) => document.getElementById(id);

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* 통합조회의 토스트 한 자리를 함께 쓴다. 탭마다 따로 두면 탭을 옮길 때
   앞 탭의 안내가 남아 새 탭의 것처럼 보인다. */
let toastTimer;
export function toast(message) {
  const node = $('toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
}

/* 서버가 준 말을 그대로 올린다.
 *
 * 관세청·특허청·한국은행이 한글로 「인증키가 유효하지 않습니다」라고 말해 주면
 * 그게 가장 쓸모 있는 안내다. 우리 말로 옮겨 쓰면 그쪽에 문의할 때 안 통한다.
 * 우리가 손대는 것은 **다음에 무엇을 할지가 화면에 없는 두 경우**뿐이다. */
export function describe(error) {
  if (error instanceof ApiError) {
    if (error.status === 401) return '로그인이 만료되었습니다. 포털에서 다시 로그인해 주세요.';
    if (error.status === 0) return '서버에 연결하지 못했습니다.';
  }
  return error?.message || String(error);
}

export function showError(id, message) {
  const box = $(id);
  if (!box) return;
  box.hidden = false;
  box.textContent = message;
}

export function clearError(id) {
  const box = $(id);
  if (!box) return;
  box.hidden = true;
  box.textContent = '';
}

/* 조회일시 도장. 언제 본 값인지가 조서에 남아야 한다. */
export function stamp(id, text) {
  const node = $(id);
  if (!node) return;
  node.textContent = text || '';
}

export function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
       + `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ── 표 ── */

/** 열 이름 줄. 서버가 준 열 이름을 그대로 쓴다 — 화면에 또 적어 두면 갈린다. */
export function renderHead(rowId, columns, { figures = [] } = {}) {
  const tr = $(rowId);
  if (!tr) return;
  tr.innerHTML = columns
    .map((c) => `<th${figures.includes(c) ? ' class="lk-figure"' : ''}>${esc(c)}</th>`)
    .join('');
}

/**
 * 본문 줄. `rows` 는 `{열이름: 값}` 의 배열이다.
 *
 * `onRow(tr, row, index)` 를 주면 줄마다 불러 준다 — 예비심사기업이 줄을
 * 눌러 상세를 여는 자리에서 쓴다.
 */
export function renderRows(bodyId, columns, rows, {
  empty = '조회 결과가 없습니다.', figures = [], onRow = null,
} = {}) {
  const body = $(bodyId);
  if (!body) return;

  if (!rows.length) {
    body.innerHTML =
      `<tr><td colspan="${columns.length}"><div class="empty">${esc(empty)}</div></td></tr>`;
    return;
  }

  body.textContent = '';
  rows.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = columns
      .map((c) => `<td${figures.includes(c) ? ' class="lk-figure"' : ''}>${
        esc(row[c] ?? '') || '-'}</td>`)
      .join('');
    if (onRow) onRow(tr, row, index);
    body.appendChild(tr);
  });
}

/* ── 복사 ── */

/** 엑셀에 그대로 붙는 탭 구분 글. 조서로 옮기는 것이 이 화면들의 마지막 걸음이다. */
export function tableText(columns, rows) {
  const line = (cells) => cells
    .map((v) => String(v ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' '))
    .join('\t');
  return [line(columns), ...rows.map((r) => line(columns.map((c) => r[c] ?? '')))].join('\n') + '\n';
}

export async function copyText(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMessage);
    return true;
  } catch {
    // 포털이 아직 http 라 클립보드 API 가 막히는 자리가 있다. 옛 방법으로 떨어진다.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    toast(ok ? okMessage : '복사하지 못했습니다.');
    return ok;
  }
}

export function copyTable(columns, rows, label = '') {
  if (!rows.length) { toast('복사할 내용이 없습니다.'); return; }
  copyText(tableText(columns, rows),
    `${label ? label + ' ' : ''}${rows.length.toLocaleString('ko-KR')}건 복사했습니다.`);
}

/* ── 쪽 나누기 ── */

/**
 * 서버가 세는 전체 건수로 쪽을 나눈다.
 *
 * ⚠️ `nts.js` 의 것과 달리 **화면에 이미 다 와 있는 배열을 자르지 않는다.**
 *    특허·예비심사기업은 한 쪽씩 서버에서 받아 오므로, 쪽을 누르면 다시
 *    부르는 것이 맞다. 여기서 배열을 잘랐다면 2쪽은 영영 비어 있다.
 */
export function renderPager(containerId, { total, page, size, onGo }) {
  const host = $(containerId);
  if (!host) return;
  host.textContent = '';

  const pages = Math.ceil((total || 0) / (size || 1));
  if (pages <= 1) return;

  const button = (label, target, { disabled = false, active = false } = {}) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'page-btn' + (disabled ? ' disabled' : '') + (active ? ' active' : '');
    b.textContent = label;
    if (active) b.setAttribute('aria-current', 'page');
    b.onclick = () => { if (!disabled && !active) onGo(target); };
    return b;
  };

  host.appendChild(button('처음', 1, { disabled: page === 1 }));
  host.appendChild(button('이전', Math.max(1, page - 1), { disabled: page === 1 }));

  let first = Math.max(1, page - 2);
  const last = Math.min(pages, first + 4);
  first = Math.max(1, last - 4);
  for (let i = first; i <= last; i += 1) {
    host.appendChild(button(String(i), i, { active: i === page }));
  }

  host.appendChild(button('다음', Math.min(pages, page + 1), { disabled: page === pages }));
  host.appendChild(button('마지막', pages, { disabled: page === pages }));
}

/* ── 날짜 ──────────────────────────────────────────────────────────
 *
 * ## ⚠️ `toISOString()` 으로 날짜를 만들지 않는다
 *
 * `toISOString()` 은 **UTC** 다. 한국(UTC+9)에서는 00:00~09:00 사이에 하루 앞
 * 날짜가 나온다. 아침 8시에 화면을 열면 어제 날짜가 찍힌다.
 *
 * 그냥 하루 어긋나는 것으로 끝나지 않았다 — 아래 `previousBusinessDay()` 는
 * 주말인지를 **현지 시각**(`getDay()`)으로 보고 값은 UTC 로 돌려주고 있었다.
 * 둘이 어긋나는 그 시간대에, **주말을 피하려던 함수가 정확히 주말을 돌려줬다.**
 *
 *     2026-09-08(화) 08:24 KST 에서
 *       현지 어제        2026-09-07 (월)   ← 루프는 평일로 보고 안 건너뛴다
 *       toISOString()   2026-09-06 (일)   ← 그런데 이 값을 돌려줬다
 *
 * 그래서 [환율 금리]를 아침에 열면 조회일이 일요일로 잡혀 「자료 없음」이 떴다.
 * 이 함수가 막으려던 바로 그 일이다.
 *
 * `schedule.js:51` 에 같은 뜻의 `ymd()` 가 있다(거기도 한 번 데인 자리다).
 */

/** `Date` → 현지 기준 `'YYYY-MM-DD'`. UTC 로 밀리지 않는다. */
export function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    + `-${String(date.getDate()).padStart(2, '0')}`;
}

export const today = () => ymd(new Date());

/** 오늘로부터 며칠 전. 예비심사기업의 기본 조회기간(1년)에 쓴다. */
export function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return ymd(d);
}

/** `2026-09-03` → `20260903`. 한국은행은 하이픈을 받지 않는다. */
export const compact = (value) => String(value || '').replace(/-/g, '');

/**
 * 어제(주말이면 그 앞 금요일).
 *
 * 환율·시장금리는 **오늘 것이 아직 없다.** 화면이 열리자마자 오늘로 물으면
 * 늘 「자료 없음」이 뜨고, 담당자는 키가 잘못됐다고 생각한다. 옛 화면도
 * 같은 이유로 이전 영업일을 기본값으로 두고 있었다.
 *
 * ⚠️ 판정과 반환을 **같은 시간대로** 한다. 위 머리말의 그 버그 자리다 —
 *    `getDay()` 로 보고 `toISOString()` 으로 돌려주면 아침에 어긋난다.
 *
 * ⚠️ 공휴일은 안 본다. 여기서 아는 것은 토·일뿐이다. 설·추석에는 여전히 자료가
 *    없는 날이 기본값이 된다 — 그때는 사용자가 날짜를 고른다. 공휴일 달력은
 *    `workday.js` 가 들고 있지만 그건 화면이 서버에서 받아 넣어 주는 값이라
 *    이 함수(순수 계산)가 기댈 수 없다.
 */
export function previousBusinessDay() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return ymd(d);
}

/* ── 「조회 대상」 카드 접기 ──────────────────────────────────────────
 *
 * 담당부서 요청(2026-09-03): **지금 탭이 필수 값으로 쓰지 않으면 접는다.**
 *
 * 휴폐업(엑셀 업로드)·환율 금리(회사와 무관)에서는 이 카드가 세로로 자리만
 * 차지한다. 그만큼 오른쪽 결과 시트가 밀려 내려가고, 정작 쓸 칸은 접힌 것도
 * 아니어서 「채워야 하나」로 한 번 더 읽게 된다.
 *
 * ## 규칙은 하나다 — 「지금 보이는 「필수」 표시가 하나라도 있는가」
 *
 * 접을 탭 이름을 목록으로 두지 **않는다.** 그러면 탭이 늘 때마다 두 곳
 * (`NEEDS` 와 그 목록)을 같이 고쳐야 하고, 반드시 한쪽만 고쳐져 갈린다.
 * `[data-need]` 는 이미 `NEEDS` 가 칠해 둔 것이므로 그것을 그대로 읽는다.
 *
 * 덕분에 **갈래마다 필수가 다른 탭**도 공짜로 따라온다 — 수입신고필증은
 * 필증 검증에서는 펴지고 처리이력·요건승인에서는 접힌다(`import_decl.js`
 * 가 갈래를 바꾼 뒤 `syncCompanyFold()` 를 다시 부른다).
 *
 * ## ⚠️ 접어도 값은 살아 있다
 *
 * 몸통을 `hidden` 으로 덮을 뿐 칸을 지우거나 비우지 않는다. 각 탭이 읽는
 * `lk-name`·`lk-biz`·`lk-crno` 가 그대로라 접힌 채로도 조회가 된다.
 * (예비심사기업은 회사명을 **선택**으로 쓰므로 접힌 채 조회되는 것이 맞다.)
 *
 * ## ⚠️ 접힌 칸에는 초점을 줄 수 없다
 *
 * 「회사명을 넣어 주세요」 같은 안내와 함께 `focus()` 를 하려면 **먼저 펴야**
 * 한다. 안 그러면 아무 일도 안 일어나 「눌렀는데 반응이 없다」가 된다.
 * 그 자리에서는 `focusShared()` 를 쓴다.
 */

const FOLD = { card: 'lk-company', button: 'lk-fold', body: 'lk-company-body',
               summary: 'lk-company-summary' };

/** 접힌 머리에 지금 회사를 한 줄로 적는다. 접혀도 무엇을 보고 있는지는 남는다. */
export function paintCompanySummary() {
  const node = $(FOLD.summary);
  if (!node) return;
  const open = $(FOLD.button)?.getAttribute('aria-expanded') !== 'false';
  if (open) {
    node.textContent = '탭이 바뀌어도 남습니다';
    return;
  }
  const label = companyLabel();
  node.textContent = label || '비어 있음 — 눌러서 넣기';
}

/** 접거나(true) 편다(false). */
export function foldCompany(collapsed) {
  const card = $(FOLD.card);
  const button = $(FOLD.button);
  const body = $(FOLD.body);
  if (!card || !button || !body) return;

  body.hidden = collapsed;
  card.classList.toggle('folded', collapsed);
  button.setAttribute('aria-expanded', String(!collapsed));
  paintCompanySummary();
}

/**
 * 지금 화면 상태에 맞춰 접거나 편다.
 *
 * 「필수」 표시가 하나라도 보이면 펴고, 하나도 없으면 접는다. 위 머리말 참고.
 */
export function syncCompanyFold() {
  const anyRequired = [...document.querySelectorAll('[data-need]')].some((n) => !n.hidden);
  foldCompany(!anyRequired);
}

/** 접혀 있으면 펴고 나서 그 칸으로 간다. 안내와 함께 부르는 자리에서 쓴다. */
export function focusShared(id) {
  foldCompany(false);
  $(id)?.focus();
}
